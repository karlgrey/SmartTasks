import { createDb, type Db } from './db';
import { createUser, type SafeUser } from './auth';

export function testDb(): Db {
	return createDb(':memory:');
}

export function seedUsers(db: Db): { micha: SafeUser; claude: SafeUser } {
	return {
		micha: createUser(db, { name: 'Micha', email: 'micha@test.dev', type: 'human', password: 'pw12345' }),
		claude: createUser(db, { name: 'Claude', type: 'ai' })
	};
}
