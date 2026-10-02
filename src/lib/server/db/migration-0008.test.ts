import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';

// 0008_routines.sql (#795): neue Tabellen routines/routine_runs und die
// zusätzliche Spalte tasks.routine_run_id — ohne bestehende Daten anzufassen.
function applyMigration(db: Database.Database, file: string) {
	const sql = readFileSync(`drizzle/${file}`, 'utf-8').replace(/--> statement-breakpoint/g, '');
	db.exec(sql);
}

function dbBefore0008() {
	const db = new Database(':memory:');
	db.pragma('foreign_keys = ON');
	for (const f of readdirSync('drizzle').filter((f) => f.endsWith('.sql') && f < '0008').sort())
		applyMigration(db, f);
	return db;
}

describe('migration 0008: routines', () => {
	it('keeps existing tasks untouched and creates no routines', () => {
		const db = dbBefore0008();
		db.prepare(`INSERT INTO users (name, type, color) VALUES ('Micha', 'human', '#6b7280')`).run();
		db.prepare(
			`INSERT INTO tasks (title, description, status, created_by, created_at, updated_at) VALUES ('Alt', '', 'To Do', 1, 'x', 'x')`
		).run();
		applyMigration(db, '0008_routines.sql');

		const task = db.prepare('SELECT title, status, routine_run_id FROM tasks').get() as Record<string, unknown>;
		expect(task).toEqual({ title: 'Alt', status: 'To Do', routine_run_id: null });
		expect(db.prepare('SELECT count(*) AS n FROM routines').get()).toEqual({ n: 0 });
		expect(db.prepare('SELECT count(*) AS n FROM routine_runs').get()).toEqual({ n: 0 });
		db.close();
	});

	it('creates the columns and enforces UNIQUE (routine_id, due)', () => {
		const db = dbBefore0008();
		applyMigration(db, '0008_routines.sql');
		const cols = (t: string) =>
			(db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
		expect(cols('routines')).toEqual(
			expect.arrayContaining(['title', 'project_id', 'rhythm', 'lead_days', 'materialize', 'active', 'next_due'])
		);
		expect(cols('routine_runs')).toEqual(
			expect.arrayContaining(['routine_id', 'due', 'status', 'task_id', 'done_at', 'note'])
		);
		expect(cols('tasks')).toContain('routine_run_id');

		db.prepare(`INSERT INTO users (name, type, color) VALUES ('Micha', 'human', '#6b7280')`).run();
		db.prepare(`INSERT INTO projects (name, color, archived) VALUES ('P', '#fff', 0)`).run();
		db.prepare(
			`INSERT INTO routines (title, project_id, rhythm, next_due, created_by, created_at, updated_at) VALUES ('R', 1, '{}', '2026-10-05', 1, 'x', 'x')`
		).run();
		const ins = db.prepare(
			`INSERT INTO routine_runs (routine_id, due, status, created_at) VALUES (1, '2026-10-05', 'open', 'x')`
		);
		ins.run();
		expect(() => ins.run()).toThrowError(/UNIQUE/);
		db.close();
	});
});
