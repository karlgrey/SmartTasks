import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listDocuments, createDocument, parseDocFilters } from '$lib/server/documents-service';

export const GET: RequestHandler = ({ locals, url }) =>
	run(() => {
		requireUser(locals);
		return json(listDocuments(db, parseDocFilters(url.searchParams)));
	});

export const POST: RequestHandler = ({ locals, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const doc = createDocument(db, user, await request.json().catch(() => ({})));
		return json(doc, { status: 201 });
	});
