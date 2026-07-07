import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { addComment } from '$lib/server/comments-service';
import { emit } from '$lib/server/events';

export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const body = (await request.json().catch(() => ({}))).body as string;
		const { comment, task } = addComment(db, user, Number(params.id), body);
		emit({ type: 'comment.created', task, comment });
		return json(comment, { status: 201 });
	});
