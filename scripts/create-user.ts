import { randomBytes } from 'node:crypto';
import { createDb } from '../src/lib/server/db';
import { createUser } from '../src/lib/server/auth';

const [name, email, color] = process.argv.slice(2);
if (!name || !email) {
	console.error('usage: npx tsx scripts/create-user.ts <name> <email> [color]');
	process.exit(1);
}
const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');
const password = randomBytes(9).toString('base64url');
const user = createUser(db, { name, email, type: 'human', password, color });
console.log(`${user.name} <${email}>  password: ${password}`);
console.log('Store it now — it is not retrievable later.');
