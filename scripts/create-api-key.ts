import { sql } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import { setApiKey } from '../src/lib/server/auth';

const name = process.argv[2];
if (!name) {
	console.error('usage: npx tsx scripts/create-api-key.ts <user-name>');
	process.exit(1);
}
const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');
const user = db.select().from(users).where(sql`lower(${users.name}) = lower(${name})`).get();
if (!user) {
	console.error(`user "${name}" not found`);
	process.exit(1);
}
console.log(setApiKey(db, user.id));
