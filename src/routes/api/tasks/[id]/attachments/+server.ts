import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { ServiceError } from '$lib/server/errors';
import { addAttachment, uploadsDir } from '$lib/server/attachments-service';

export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const form = await request.formData().catch(() => null);
		const file = form?.get('file');
		if (!(file instanceof File)) throw new ServiceError(400, 'multipart field "file" is required');
		const attachment = addAttachment(
			db,
			user,
			Number(params.id),
			{ filename: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) },
			uploadsDir()
		);
		return json(attachment, { status: 201 });
	});
