import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listLocations, createLocation } from '$lib/server/locations-service';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		requireUser(locals);
		return json(listLocations(db));
	});

export const POST: RequestHandler = ({ locals, request }) =>
	run(async () => {
		requireUser(locals);
		return json(createLocation(db, await request.json().catch(() => ({}))), { status: 201 });
	});
