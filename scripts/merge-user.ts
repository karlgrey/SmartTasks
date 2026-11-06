// User <von> komplett in User <nach> zusammenführen und <von> löschen —
// Betreiber-Skript. Alle Zeilen, die per FK auf <von> zeigen, werden auf <nach>
// umgehängt; API-Keys und Sessions von <von> werden gelöscht (nie übertragen).
// Eine Transaktion, mit Nachprüfung. VORHER DB-Backup ziehen! Aufruf auf labs
// in /opt/smarttasks:
//   DATABASE_PATH=/opt/smarttasks/data/smarttasks.db npx tsx scripts/merge-user.ts <von> <nach> [--dry-run]
import { createDb } from '../src/lib/server/db';
import { mergeUser } from '../src/lib/server/merge-user';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const ids = args.filter((a) => a !== '--dry-run');
const usage = () => {
	console.error('usage: npx tsx scripts/merge-user.ts <von-id> <nach-id> [--dry-run]');
	process.exit(1);
};
if (ids.length !== 2 || !ids.every((a) => /^[1-9]\d*$/.test(a))) usage();
const [fromId, toId] = ids.map(Number);

try {
	const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');
	const r = mergeUser(db, fromId, toId, { dryRun });
	console.log(`Merge User ${r.from.id} (${r.from.name}) -> ${r.to.id} (${r.to.name})${dryRun ? '  DRY-RUN' : ''}`);
	const w = Math.max(...r.columns.map((c) => `${c.table}.${c.column}`.length));
	console.log(`${'spalte'.padEnd(w)}  aktion  vorher  nachher`);
	for (const c of r.columns) {
		console.log(
			`${`${c.table}.${c.column}`.padEnd(w)}  ${c.action.padEnd(6)}  ${String(c.before).padStart(6)}  ${String(c.after).padStart(7)}`
		);
	}
	console.log(
		dryRun
			? 'Dry-Run: keine Änderung'
			: `OK: nichts zeigt mehr auf User ${r.from.id}, users-Zeile gelöscht`
	);
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}
