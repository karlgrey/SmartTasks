import { describe, it, expect } from 'vitest';
import { json } from '@sveltejs/kit';
import { requireUser, run } from './api-utils';
import { ServiceError } from './errors';

describe('api-utils', () => {
	it('requireUser throws 401 without a user and returns the user otherwise', () => {
		expect(() => requireUser({ user: null })).toThrowError(ServiceError);
		const user = { id: 1, name: 'M', email: null, type: 'human' as const, color: '#fff' };
		expect(requireUser({ user })).toBe(user);
	});

	it('run maps ServiceError to a JSON error response', async () => {
		const res = await run(() => {
			throw new ServiceError(403, 'AI users cannot set status to Done');
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'AI users cannot set status to Done' });
	});

	it('run passes successful responses through', async () => {
		const res = await run(() => json({ ok: true }));
		expect(res.status).toBe(200);
	});
});
