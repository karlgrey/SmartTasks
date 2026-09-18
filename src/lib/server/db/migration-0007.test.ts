import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { hashApiKey } from '../auth';

// Testet die Daten-Migration in 0007_api_keys.sql isoliert: baut den Stand
// vor #670 nach (Migrationen 0000-0006, ein Key pro User in
// users.api_key_hash), spielt dann 0007 ein und prüft, dass der bestehende
// Hash unverändert als Key "Laptop" landet — kein Datenverlust.
describe('migration 0007: api_keys backfill', () => {
	function applyMigration(db: Database.Database, file: string) {
		const sql = readFileSync(`drizzle/${file}`, 'utf-8').replace(/--> statement-breakpoint/g, '');
		db.exec(sql);
	}

	it('copies an existing users.api_key_hash into api_keys as "Laptop", 1:1 und ohne Datenverlust', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');

		const priorMigrations = readdirSync('drizzle')
			.filter((f) => f.endsWith('.sql') && f < '0007')
			.sort();
		for (const file of priorMigrations) applyMigration(db, file);

		const oldHash = hashApiKey('st_bestandskey');
		db.prepare(
			`INSERT INTO users (name, type, api_key_hash, color) VALUES (?, 'ai', ?, '#6b7280')`
		).run('Claude', oldHash);
		// User ohne Key darf keine Zeile erzeugen.
		db.prepare(`INSERT INTO users (name, type, color) VALUES (?, 'human', '#6b7280')`).run('Micha');

		applyMigration(db, '0007_api_keys.sql');

		const rows = db.prepare('SELECT * FROM api_keys').all() as Array<{
			user_id: number;
			name: string;
			key_hash: string;
			revoked_at: string | null;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0].name).toBe('Laptop');
		expect(rows[0].key_hash).toBe(oldHash);
		expect(rows[0].revoked_at).toBeNull();

		// users.api_key_hash bleibt unangetastet stehen (kein Datenverlust).
		const claude = db.prepare('SELECT api_key_hash FROM users WHERE name = ?').get('Claude') as {
			api_key_hash: string;
		};
		expect(claude.api_key_hash).toBe(oldHash);

		db.close();
	});
});
