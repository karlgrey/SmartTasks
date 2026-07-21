import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { ServiceError } from '$lib/server/errors';
import {
	getAttachment,
	deleteAttachment,
	attachmentPath,
	uploadsDir,
	contentDisposition
} from '$lib/server/attachments-service';

export const GET: RequestHandler = ({ locals, params }) =>
	run(() => {
		requireUser(locals);
		const attachment = getAttachment(db, Number(params.id));
		let data: Buffer;
		try {
			data = readFileSync(attachmentPath(attachment, uploadsDir()));
		} catch {
			throw new ServiceError(404, 'attachment file missing');
		}
		return new Response(new Uint8Array(data), {
			headers: {
				'content-type': attachment.mime,
				'content-length': String(data.length),
				'content-disposition': contentDisposition(attachment.filename, attachment.mime),
				// content is immutable: replacing a photo creates a new id
				'cache-control': 'private, max-age=31536000, immutable'
			}
		});
	});

export const DELETE: RequestHandler = ({ locals, params }) =>
	run(() => {
		const user = requireUser(locals);
		deleteAttachment(db, user, Number(params.id), uploadsDir());
		return json({ ok: true });
	});
