import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { db } from '$lib/server/db';
import { loginWithPassword } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const { email, password } = await request.json().catch(() => ({}));
	const result = email && password ? loginWithPassword(db, email, password) : null;
	if (!result) return json({ error: 'invalid credentials' }, { status: 401 });
	cookies.set('session', result.token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 30 * 24 * 60 * 60
	});
	return json(result.user);
};
