import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { updateLocation } from '$lib/server/locations-service';

export const PATCH: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		requireUser(locals);
		return json(updateLocation(db, Number(params.id), await request.json().catch(() => ({}))));
	});
