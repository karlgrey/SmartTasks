import { sql } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import { setApiKey } from '../src/lib/server/auth';

// #670: legt einen ZUSÄTZLICHEN Key an (überschreibt keinen bestehenden mehr).
// Aufruf ohne Namen bleibt kompatibel — Default-Name "Key <Datum>" (setApiKey).
const userName = process.argv[2];
const keyName = process.argv[3];
if (!userName) {
	console.error('usage: npx tsx scripts/create-api-key.ts <user-name> [key-name]');
	process.exit(1);
}
const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');
const user = db.select().from(users).where(sql`lower(${users.name}) = lower(${userName})`).get();
if (!user) {
	console.error(`user "${userName}" not found`);
	process.exit(1);
}
console.log(setApiKey(db, user.id, keyName));
