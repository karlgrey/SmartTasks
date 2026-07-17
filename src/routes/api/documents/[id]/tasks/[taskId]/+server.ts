import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { unlinkTask } from '$lib/server/documents-service';

export const DELETE: RequestHandler = ({ locals, params }) =>
	run(() => {
		const user = requireUser(locals);
		unlinkTask(db, user, Number(params.id), Number(params.taskId));
		return json({ ok: true });
	});
