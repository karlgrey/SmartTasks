import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createUser, setApiKey, loginWithPassword, resolveUser, deleteSession } from './auth';
import { sessions } from './db/schema';
import { testDb } from './test-utils';

describe('auth', () => {
	it('logs in with correct password only', () => {
		const db = testDb();
		createUser(db, { name: 'Micha', email: 'm@test.dev', type: 'human', password: 'secret1' });
		expect(loginWithPassword(db, 'm@test.dev', 'wrong')).toBeNull();
		expect(loginWithPassword(db, 'nobody@test.dev', 'secret1')).toBeNull();
		const result = loginWithPassword(db, 'M@TEST.DEV', 'secret1');
		expect(result?.user.name).toBe('Micha');
		expect(result?.token).toHaveLength(64);
	});

	it('resolves a user from a session token, until logout or expiry', () => {
		const db = testDb();
		createUser(db, { name: 'Micha', email: 'm@test.dev', type: 'human', password: 'secret1' });
		const { token, user } = loginWithPassword(db, 'm@test.dev', 'secret1')!;
		expect(resolveUser(db, { sessionToken: token })?.id).toBe(user.id);
		// expired session
		db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.token, token)).run();
		expect(resolveUser(db, { sessionToken: token })).toBeNull();
		deleteSession(db, token);
		expect(resolveUser(db, { sessionToken: token })).toBeNull();
	});

	it('resolves an AI user from a bearer api key', () => {
		const db = testDb();
		const claude = createUser(db, { name: 'Claude', type: 'ai' });
		const key = setApiKey(db, claude.id);
		expect(key).toMatch(/^st_/);
		const resolved = resolveUser(db, { bearer: `Bearer ${key}` });
		expect(resolved?.name).toBe('Claude');
		expect(resolved?.type).toBe('ai');
		expect(resolveUser(db, { bearer: 'Bearer st_wrong' })).toBeNull();
	});

	it('never exposes hashes on SafeUser', () => {
		const db = testDb();
		const u = createUser(db, { name: 'X', email: 'x@test.dev', type: 'human', password: 'p' });
		expect(u).not.toHaveProperty('passwordHash');
		expect(u).not.toHaveProperty('apiKeyHash');
	});
});
