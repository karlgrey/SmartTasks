import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listRuns, reportRun } from '$lib/server/routines-service';

export const GET: RequestHandler = ({ locals, params, url }) =>
	run(() => {
		const user = requireUser(locals);
		const limit = url.searchParams.get('limit');
		return json(listRuns(db, user, Number(params.id), { limit: limit ? Number(limit) : undefined }));
	});

export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const created = reportRun(db, user, Number(params.id), await request.json().catch(() => ({})));
		return json(created, { status: 201 });
	});
