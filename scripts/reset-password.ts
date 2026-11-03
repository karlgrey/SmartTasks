// Passwort eines Human-Users zurücksetzen (ohne altes Passwort) — Betreiber-Skript,
// Gegenstück zu create-user.ts. Aufruf auf labs in /opt/smarttasks:
//   npx tsx scripts/reset-password.ts <email>
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';

const [email] = process.argv.slice(2);
if (!email) {
	console.error('usage: npx tsx scripts/reset-password.ts <email>');
	process.exit(1);
}
const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');
const u = db.select().from(users).where(eq(users.email, email)).get();
if (!u) {
	console.error(`no user with email ${email}`);
	process.exit(1);
}
if (u.type !== 'human') {
	console.error(`${u.name} is type ${u.type} — nur Human-User haben Passwörter`);
	process.exit(1);
}
const password = randomBytes(9).toString('base64url');
db.update(users)
	.set({ passwordHash: bcrypt.hashSync(password, 10) })
	.where(eq(users.id, u.id))
	.run();
console.log(`${u.name} <${email}>  new password: ${password}`);
console.log('Store it now — it is not retrievable later.');
