import { describe, it, expect } from 'vitest';
import { testDb, seedUsers } from './test-utils';
import { createUser, setApiKey } from './auth';
import { findUserFkColumns, mergeUser } from './merge-user';
import type { Db } from './db';

const EXPECTED = [
	'api_keys.user_id',
	'attachments.created_by',
	'comments.author_id',
	'documents.created_by',
	'projects.owner_id',
	'routines.assignee_id',
	'routines.created_by',
	'sessions.user_id',
	'status_events.user_id',
	'tasks.assignee_id',
	'tasks.created_by'
];

const NOW = '2026-01-01T00:00:00.000Z';

// Legt je Spalte Daten für User u an (Roh-SQL); sessions/api_keys inklusive.
function seedData(db: Db, u: number, tag: string) {
	const c = db.$client;
	const pid = Number(c.prepare('INSERT INTO projects (name, owner_id) VALUES (?, ?)').run('P-' + tag, u).lastInsertRowid);
	const t1 = Number(
		c
			.prepare('INSERT INTO tasks (title, status, assignee_id, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)')
			.run('T1-' + tag, 'Inbox', u, u, NOW, NOW).lastInsertRowid
	);
	c.prepare('INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?,?,?,?)').run(t1, u, 'c', NOW);
	c.prepare('INSERT INTO status_events (task_id, user_id, to_status, created_at) VALUES (?,?,?,?)').run(t1, u, 'Inbox', NOW);
	c.prepare('INSERT INTO attachments (task_id, filename, mime, size, created_by, created_at) VALUES (?,?,?,?,?,?)').run(
		t1, 'f.txt', 'text/plain', 1, u, NOW
	);
	c.prepare('INSERT INTO documents (title, created_by, created_at, updated_at) VALUES (?,?,?,?)').run('D-' + tag, u, NOW, NOW);
	c.prepare(
		'INSERT INTO routines (title, project_id, assignee_id, rhythm, next_due, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
	).run('R-' + tag, pid, u, JSON.stringify({ kind: 'daily' }), '2026-02-01', u, NOW, NOW);
	setApiKey(db, u, 'key-' + tag);
	c.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run('tok-' + tag, u, 9999999999);
}

function counts(db: Db, id: number): Record<string, number> {
	const out: Record<string, number> = {};
	for (const e of EXPECTED) {
		const [t, col] = e.split('.');
		out[e] = (db.$client.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE "${col}" = ?`).get(id) as { n: number }).n;
	}
	return out;
}

function setup() {
	const db = testDb();
	const { micha, claude } = seedUsers(db);
	const third = createUser(db, { name: 'Dritter', type: 'ai' });
	seedData(db, claude.id, 'from');
	seedData(db, micha.id, 'to');
	seedData(db, third.id, 'third');
	return { db, from: claude, to: micha, third };
}

describe('findUserFkColumns', () => {
	it('liefert genau die erwarteten 11 FK-Spalten auf users.id (Drift-Wächter)', () => {
		// Neue FK-Spalte auf users? Dann hier eintragen UND in merge-user.ts
		// entscheiden: umhängen (update) oder löschen (delete).
		const cols = findUserFkColumns(testDb()).map((c) => `${c.table}.${c.column}`).sort();
		expect(cols).toEqual(EXPECTED);
	});
});

describe('mergeUser', () => {
	it('hängt Zeilen um, löscht Keys/Sessions und den Alt-User', () => {
		const { db, from, to, third } = setup();
		const toKeysBefore = counts(db, to.id)['api_keys.user_id'];
		const thirdBefore = counts(db, third.id);
		const toBefore = counts(db, to.id);

		const r = mergeUser(db, from.id, to.id);

		expect(r.dryRun).toBe(false);
		expect(r.from).toEqual({ id: from.id, name: 'Claude' });
		expect(r.to).toEqual({ id: to.id, name: 'Micha' });
		expect(r.columns).toHaveLength(11);
		for (const c of r.columns) {
			expect(c.after).toBe(0);
			expect(c.before).toBe(1);
			expect(c.action).toBe(c.table === 'api_keys' || c.table === 'sessions' ? 'delete' : 'update');
		}
		expect(counts(db, from.id)).toEqual(Object.fromEntries(EXPECTED.map((e) => [e, 0])));
		const after = counts(db, to.id);
		for (const e of EXPECTED) {
			if (e.startsWith('api_keys') || e.startsWith('sessions')) expect(after[e]).toBe(toBefore[e]);
			else expect(after[e]).toBe(toBefore[e] + 1);
		}
		expect(after['api_keys.user_id']).toBe(toKeysBefore);
		expect(db.$client.prepare('SELECT COUNT(*) n FROM sessions WHERE token = ?').get('tok-from')).toEqual({ n: 0 });
		expect(db.$client.prepare('SELECT id FROM users WHERE id = ?').get(from.id)).toBeUndefined();
		expect(counts(db, third.id)).toEqual(thirdBefore);
	});

	it('Dry-Run zählt, ändert aber nichts', () => {
		const { db, from, to } = setup();
		const fromBefore = counts(db, from.id);
		const toBefore = counts(db, to.id);
		const r = mergeUser(db, from.id, to.id, { dryRun: true });
		expect(r.dryRun).toBe(true);
		for (const c of r.columns) {
			expect(c.before).toBeGreaterThan(0);
			expect(c.after).toBe(c.before);
		}
		expect(counts(db, from.id)).toEqual(fromBefore);
		expect(counts(db, to.id)).toEqual(toBefore);
		expect(db.$client.prepare('SELECT id FROM users WHERE id = ?').get(from.id)).toBeDefined();
	});

	it('wirft bei from === to und unbekannten IDs, ohne etwas zu ändern', () => {
		const { db, from, to } = setup();
		const snapshot = counts(db, from.id);
		expect(() => mergeUser(db, from.id, from.id)).toThrow();
		expect(() => mergeUser(db, 9999, to.id)).toThrow();
		expect(() => mergeUser(db, from.id, 9999)).toThrow();
		expect(counts(db, from.id)).toEqual(snapshot);
		expect(db.$client.prepare('SELECT id FROM users WHERE id = ?').get(from.id)).toBeDefined();
	});

	it('rollt komplett zurück, wenn mitten in der Transaktion etwas scheitert', () => {
		const { db, from, to } = setup();
		// Löschen der users-Zeile scheitert -> UPDATEs/DELETEs davor müssen zurückgerollt werden.
		db.$client.exec(`CREATE TRIGGER block_user_delete BEFORE DELETE ON users
			BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);
		const fromBefore = counts(db, from.id);
		const toBefore = counts(db, to.id);
		expect(() => mergeUser(db, from.id, to.id)).toThrow(/blocked/);
		expect(counts(db, from.id)).toEqual(fromBefore);
		expect(counts(db, to.id)).toEqual(toBefore);
		expect(db.$client.prepare('SELECT id FROM users WHERE id = ?').get(from.id)).toBeDefined();
	});

	it('rollt zurück, wenn die Nachprüfung Restzeilen findet', () => {
		const { db, from, to } = setup();
		// FK-Prüfung aus, damit die Nachprüfung (nicht SQLite) den Fehler fängt; Trigger
		// setzt beim Löschen des Users eine Task-Zeile wieder auf <von>.
		db.$client.pragma('foreign_keys = OFF');
		db.$client.exec(`CREATE TRIGGER resurrect BEFORE DELETE ON users BEGIN
			UPDATE tasks SET assignee_id = OLD.id WHERE id = (SELECT MIN(id) FROM tasks);
		END;`);
		const fromBefore = counts(db, from.id);
		expect(() => mergeUser(db, from.id, to.id)).toThrow(/Nachprüfung/);
		expect(counts(db, from.id)).toEqual(fromBefore);
		expect(db.$client.prepare('SELECT id FROM users WHERE id = ?').get(from.id)).toBeDefined();
	});
});
