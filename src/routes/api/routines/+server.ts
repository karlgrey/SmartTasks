import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listRoutines, createRoutine, parseRoutineFilters } from '$lib/server/routines-service';

export const GET: RequestHandler = ({ locals, url }) =>
	run(() => {
		const user = requireUser(locals);
		return json(listRoutines(db, user, parseRoutineFilters(url.searchParams)));
	});

export const POST: RequestHandler = ({ locals, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const routine = createRoutine(db, user, await request.json().catch(() => ({})));
		return json(routine, { status: 201 });
	});
