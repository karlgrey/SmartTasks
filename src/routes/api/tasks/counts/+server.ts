import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { getTaskCounts } from '$lib/server/tasks-service';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		const user = requireUser(locals);
		return json(getTaskCounts(db, user));
	});
