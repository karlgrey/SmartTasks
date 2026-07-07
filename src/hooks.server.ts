import type { Handle } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { resolveUser } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = resolveUser(db, {
		bearer: event.request.headers.get('authorization'),
		sessionToken: event.cookies.get('session')
	});
	return resolve(event);
};
