import type { Db } from './db';

export type FkColumn = { table: string; column: string };

export type MergeUserResult = {
	from: { id: number; name: string };
	to: { id: number; name: string };
	dryRun: boolean;
	columns: Array<{ table: string; column: string; action: 'update' | 'delete'; before: number; after: number }>;
};

// Zugangsdaten werden nie auf den Ziel-User übertragen, sondern gelöscht.
const DELETE_TABLES = new Set(['api_keys', 'sessions']);

const q = (ident: string) => '"' + ident.replace(/"/g, '""') + '"';

// FK-Spalten auf users.id zur Laufzeit aus SQLite ermitteln (nicht hart codiert),
// damit neue Spalten nicht stillschweigend übersehen werden.
export function findUserFkColumns(db: Db): FkColumn[] {
	const c = db.$client;
	const tables = c
		.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`
		)
		.all() as { name: string }[];
	const out: FkColumn[] = [];
	for (const { name } of tables) {
		const fks = c.prepare(`PRAGMA foreign_key_list(${q(name)})`).all() as {
			table: string;
			from: string;
			to: string | null;
		}[];
		for (const fk of fks) {
			if (fk.table === 'users' && (fk.to === null || fk.to === 'id')) out.push({ table: name, column: fk.from });
		}
	}
	return out;
}

// Führt User fromId komplett in toId zusammen und löscht fromId (eine Transaktion).
export function mergeUser(db: Db, fromId: number, toId: number, opts: { dryRun?: boolean } = {}): MergeUserResult {
	const dryRun = opts.dryRun ?? false;
	if (fromId === toId) throw new Error('from und to sind identisch');
	const c = db.$client;
	const getUser = c.prepare('SELECT id, name FROM users WHERE id = ?');
	const from = getUser.get(fromId) as { id: number; name: string } | undefined;
	const to = getUser.get(toId) as { id: number; name: string } | undefined;
	if (!from) throw new Error(`User ${fromId} existiert nicht`);
	if (!to) throw new Error(`User ${toId} existiert nicht`);

	const cols = findUserFkColumns(db);
	const count = (col: FkColumn) =>
		(c.prepare(`SELECT COUNT(*) AS n FROM ${q(col.table)} WHERE ${q(col.column)} = ?`).get(fromId) as { n: number }).n;
	const result: MergeUserResult = {
		from,
		to,
		dryRun,
		columns: cols.map((col) => ({
			...col,
			action: DELETE_TABLES.has(col.table) ? 'delete' : 'update',
			before: count(col),
			after: 0
		}))
	};

	if (dryRun) {
		for (const r of result.columns) r.after = r.before;
		return result;
	}

	c.transaction(() => {
		// Vorher-Zähler im echten Lauf erst in der Transaktion erheben (App schreibt parallel).
		result.columns.forEach((r, i) => (r.before = count(cols[i])));
		for (const col of cols) {
			if (DELETE_TABLES.has(col.table)) {
				c.prepare(`DELETE FROM ${q(col.table)} WHERE ${q(col.column)} = ?`).run(fromId);
			} else {
				c.prepare(`UPDATE ${q(col.table)} SET ${q(col.column)} = ? WHERE ${q(col.column)} = ?`).run(toId, fromId);
			}
		}
		c.prepare('DELETE FROM users WHERE id = ?').run(fromId);
		result.columns.forEach((r, i) => (r.after = count(cols[i])));
		const rest = result.columns.filter((r) => r.after > 0);
		if (rest.length) {
			throw new Error('Nachprüfung fehlgeschlagen: ' + rest.map((r) => `${r.table}.${r.column}=${r.after}`).join(', '));
		}
		if (getUser.get(fromId)) throw new Error('Nachprüfung fehlgeschlagen: users-Zeile existiert noch');
	})();
	return result;
}
