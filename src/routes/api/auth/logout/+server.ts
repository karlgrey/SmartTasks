import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { deleteSession } from '$lib/server/auth';

export const POST: RequestHandler = ({ cookies }) => {
	const token = cookies.get('session');
	if (token) deleteSession(db, token);
	cookies.delete('session', { path: '/' });
	return json({ ok: true });
};
