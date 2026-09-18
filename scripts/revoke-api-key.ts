import { createDb } from '../src/lib/server/db';
import { revokeApiKey } from '../src/lib/server/auth';
import { ServiceError } from '../src/lib/server/errors';

// #670: widerruft einen einzelnen API-Key (Id aus api_keys, z. B. per
// SELECT id, user_id, name, created_at, last_used_at FROM api_keys ermittelt).
const idArg = process.argv[2];
const id = Number(idArg);
if (!idArg || !Number.isInteger(id)) {
	console.error('usage: npx tsx scripts/revoke-api-key.ts <id>');
	process.exit(1);
}
const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');
try {
	revokeApiKey(db, id);
	console.log(`api key ${id} revoked`);
} catch (e) {
	console.error(e instanceof ServiceError ? e.message : e);
	process.exit(1);
}
