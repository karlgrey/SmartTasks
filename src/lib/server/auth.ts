import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { users, sessions } from './db/schema';
import type { UserDTO } from '$lib/types';

export type SafeUser = UserDTO;

type UserRow = typeof users.$inferSelect;

export function toSafeUser(u: UserRow): SafeUser {
	return { id: u.id, name: u.name, email: u.email, type: u.type, color: u.color };
}

export function createUser(
	db: Db,
	input: { name: string; email?: string; type: 'human' | 'ai'; password?: string; color?: string }
): SafeUser {
	return toSafeUser(
		db
			.insert(users)
			.values({
				name: input.name,
				email: input.email ?? null,
				type: input.type,
				passwordHash: input.password ? bcrypt.hashSync(input.password, 10) : null,
				color: input.color ?? '#6b7280'
			})
			.returning()
			.get()
	);
}

export function hashApiKey(key: string): string {
	return createHash('sha256').update(key).digest('hex');
}

export function setApiKey(db: Db, userId: number): string {
	const key = 'st_' + randomBytes(24).toString('hex');
	db.update(users).set({ apiKeyHash: hashApiKey(key) }).where(eq(users.id, userId)).run();
	return key;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function loginWithPassword(
	db: Db,
	email: string,
	password: string
): { user: SafeUser; token: string } | null {
	const u = db
		.select()
		.from(users)
		.where(sql`lower(${users.email}) = lower(${email})`)
		.get();
	if (!u?.passwordHash || !bcrypt.compareSync(password, u.passwordHash)) return null;
	const token = randomBytes(32).toString('hex');
	db.insert(sessions)
		.values({ token, userId: u.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
		.run();
	return { user: toSafeUser(u), token };
}

export function deleteSession(db: Db, token: string): void {
	db.delete(sessions).where(eq(sessions.token, token)).run();
}

export function resolveUser(
	db: Db,
	opts: { bearer?: string | null; sessionToken?: string | null }
): SafeUser | null {
	if (opts.bearer?.startsWith('Bearer ')) {
		const hash = hashApiKey(opts.bearer.slice(7).trim());
		const u = db.select().from(users).where(eq(users.apiKeyHash, hash)).get();
		return u ? toSafeUser(u) : null;
	}
	if (opts.sessionToken) {
		const row = db
			.select({ session: sessions, user: users })
			.from(sessions)
			.innerJoin(users, eq(users.id, sessions.userId))
			.where(eq(sessions.token, opts.sessionToken))
			.get();
		if (!row || row.session.expiresAt.getTime() < Date.now()) return null;
		return toSafeUser(row.user);
	}
	return null;
}
