import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listTasks, createTask, parseTaskFilters } from '$lib/server/tasks-service';
import { emit } from '$lib/server/events';

export const GET: RequestHandler = ({ locals, url }) =>
	run(() => {
		requireUser(locals);
		return json(listTasks(db, parseTaskFilters(url.searchParams)));
	});

export const POST: RequestHandler = ({ locals, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const task = createTask(db, user, await request.json().catch(() => ({})));
		emit({ type: 'task.created', task });
		return json(task, { status: 201 });
	});
