import { json } from '@sveltejs/kit';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';

export function requireUser(locals: { user: SafeUser | null }): SafeUser {
	if (!locals.user) throw new ServiceError(401, 'authentication required');
	return locals.user;
}

export async function run(fn: () => Response | Promise<Response>): Promise<Response> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof ServiceError) return json({ error: e.message }, { status: e.status });
		throw e;
	}
}
