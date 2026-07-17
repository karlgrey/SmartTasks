import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { ServiceError } from '$lib/server/errors';
import { linkTask } from '$lib/server/documents-service';

// Reciprocal link endpoint: the task detail UI knows its own task id and picks a
// document to attach. Same service as /api/documents/:id/tasks.
export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const body = await request.json().catch(() => ({}));
		if (typeof body.documentId !== 'number') throw new ServiceError(400, 'documentId is required');
		linkTask(db, user, body.documentId, Number(params.id));
		return json({ ok: true }, { status: 201 });
	});
