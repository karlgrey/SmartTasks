import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { ServiceError } from '$lib/server/errors';
import { linkTask } from '$lib/server/documents-service';

export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const body = await request.json().catch(() => ({}));
		if (typeof body.taskId !== 'number') throw new ServiceError(400, 'taskId is required');
		linkTask(db, user, Number(params.id), body.taskId);
		return json({ ok: true }, { status: 201 });
	});
