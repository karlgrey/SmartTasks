import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { getDocument, updateDocument, deleteDocument } from '$lib/server/documents-service';

export const GET: RequestHandler = ({ locals, params }) =>
	run(() => {
		requireUser(locals);
		return json(getDocument(db, Number(params.id)));
	});

export const PATCH: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		return json(updateDocument(db, user, Number(params.id), await request.json().catch(() => ({}))));
	});

export const DELETE: RequestHandler = ({ locals, params }) =>
	run(() => {
		const user = requireUser(locals);
		deleteDocument(db, user, Number(params.id));
		return json({ ok: true });
	});
