import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { getRoutinesDashboard, parseRoutineFilters } from '$lib/server/routines-service';

export const GET: RequestHandler = ({ locals, url }) =>
	run(() => {
		const user = requireUser(locals);
		const { project, assignee } = parseRoutineFilters(url.searchParams);
		return json(getRoutinesDashboard(db, user, { project, assignee }));
	});
