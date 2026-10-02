import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { attachTask } from '$lib/server/routines-service';
import { emit } from '$lib/server/events';

export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const result = attachTask(db, user, Number(params.id), await request.json().catch(() => ({})));
		emit({ type: 'task.updated', task: result.task });
		return json(result);
	});
