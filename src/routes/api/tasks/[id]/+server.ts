import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { getTask, updateTask } from '$lib/server/tasks-service';
import { emit } from '$lib/server/events';

export const GET: RequestHandler = ({ locals, params }) =>
	run(() => {
		requireUser(locals);
		return json(getTask(db, Number(params.id)));
	});

export const PATCH: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const task = updateTask(db, user, Number(params.id), await request.json().catch(() => ({})));
		emit({ type: 'task.updated', task });
		return json(task);
	});
