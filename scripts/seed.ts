import { randomBytes } from 'node:crypto';
import { createDb } from '../src/lib/server/db';
import { createUser, setApiKey } from '../src/lib/server/auth';

const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');

// Further users (Ulf, Holger, …) are added later via scripts/create-user.ts —
// never seed placeholder email addresses into production.
const HUMANS = [{ name: 'Micha', email: 'micha@remoterepublic.com', color: '#ef4444' }];

for (const human of HUMANS) {
	const password = randomBytes(9).toString('base64url');
	const user = createUser(db, { ...human, type: 'human', password });
	console.log(`${user.name} <${human.email}>  password: ${password}`);
}

const claude = createUser(db, { name: 'Claude', type: 'ai', color: '#8b5cf6' });
console.log(`Claude  api key: ${setApiKey(db, claude.id)}`);
console.log('\nStore these now — they are not retrievable later.');
