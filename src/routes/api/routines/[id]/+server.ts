import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { getRoutine, updateRoutine, deleteRoutine } from '$lib/server/routines-service';

export const GET: RequestHandler = ({ locals, params }) =>
	run(() => {
		const user = requireUser(locals);
		return json(getRoutine(db, user, Number(params.id)));
	});

export const PATCH: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		return json(updateRoutine(db, user, Number(params.id), await request.json().catch(() => ({}))));
	});

export const DELETE: RequestHandler = ({ locals, params }) =>
	run(() => {
		const user = requireUser(locals);
		deleteRoutine(db, user, Number(params.id));
		return json({ ok: true });
	});
