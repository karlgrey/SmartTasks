import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listUsers } from '$lib/server/projects-service';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		requireUser(locals);
		return json(listUsers(db));
	});
