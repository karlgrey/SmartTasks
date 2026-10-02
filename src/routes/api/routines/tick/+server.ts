import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { tickRoutines } from '$lib/server/routines-service';
import { emit } from '$lib/server/events';

export const POST: RequestHandler = ({ locals }) =>
	run(() => {
		requireUser(locals);
		const { tasks, ...result } = tickRoutines(db);
		for (const task of tasks) emit({ type: 'task.created', task });
		return json(result);
	});
