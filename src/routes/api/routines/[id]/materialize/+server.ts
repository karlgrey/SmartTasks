import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { materializeRun } from '$lib/server/routines-service';
import { emit } from '$lib/server/events';

export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const { run: lauf, task, created } = materializeRun(
			db,
			user,
			Number(params.id),
			await request.json().catch(() => ({}))
		);
		if (created) emit({ type: 'task.created', task });
		return json({ run: lauf, task }, { status: 201 });
	});
