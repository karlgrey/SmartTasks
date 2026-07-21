import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, attachments } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import type { AttachmentDTO } from '$lib/types';

const MAX_SIZE = 5 * 1024 * 1024;

// Accepted file extensions per MIME type (first entry is canonical, used for
// the on-disk filename). v2 (#201) widened this from images-only to also
// allow documents; validation still requires MIME + extension to agree.
const MIME_EXTENSIONS: Record<string, readonly string[]> = {
	'image/jpeg': ['jpg', 'jpeg'],
	'image/png': ['png'],
	'image/webp': ['webp'],
	'application/pdf': ['pdf'],
	'text/plain': ['txt'],
	'text/csv': ['csv'],
	'application/zip': ['zip'],
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx']
};

function extOf(filename: string): string {
	const i = filename.lastIndexOf('.');
	return i === -1 ? '' : filename.slice(i + 1).toLowerCase();
}

export function isImageAttachment(mime: string): boolean {
	return mime.startsWith('image/');
}

/** Content-Disposition for GET /api/attachments/:id: images stay inline
 *  (thumbnails/full view), everything else forces a download with the
 *  original filename (RFC 5987 for non-ASCII names). */
export function contentDisposition(filename: string, mime: string): string {
	if (isImageAttachment(mime)) return 'inline';
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function uploadsDir(): string {
	return join(dirname(process.env.DATABASE_PATH ?? 'data/smarttasks.db'), 'uploads');
}

export function attachmentPath(a: { id: number; mime: string }, dir: string): string {
	return join(dir, `${a.id}.${MIME_EXTENSIONS[a.mime]?.[0] ?? 'bin'}`);
}

export type AttachmentFile = { filename: string; mime: string; data: Buffer };

export function addAttachment(
	db: Db,
	user: SafeUser,
	taskId: number,
	file: AttachmentFile,
	dir: string
): AttachmentDTO {
	if (user.type === 'ai') throw new ServiceError(403, 'AI users cannot upload attachments');
	const allowedExts = MIME_EXTENSIONS[file.mime];
	if (!allowedExts)
		throw new ServiceError(
			400,
			`unsupported file type: must be one of ${Object.keys(MIME_EXTENSIONS).join(', ')}`
		);
	if (!allowedExts.includes(extOf(file.filename)))
		throw new ServiceError(400, `file extension does not match type ${file.mime}`);
	if (file.data.length === 0) throw new ServiceError(400, 'file is empty');
	if (file.data.length > MAX_SIZE) throw new ServiceError(400, 'file too large (max 5 MB)');
	if (!db.select().from(tasks).where(eq(tasks.id, taskId)).get())
		throw new ServiceError(404, 'task not found');
	const row = db
		.insert(attachments)
		.values({
			taskId,
			filename: file.filename || 'photo.jpg',
			mime: file.mime,
			size: file.data.length,
			createdBy: user.id,
			createdAt: new Date().toISOString()
		})
		.returning()
		.get();
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(attachmentPath(row, dir), file.data);
	} catch (e) {
		db.delete(attachments).where(eq(attachments.id, row.id)).run();
		throw e;
	}
	return row;
}

export function getAttachment(db: Db, id: number): AttachmentDTO {
	const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
	if (!row) throw new ServiceError(404, 'attachment not found');
	return row;
}

export function deleteAttachment(db: Db, user: SafeUser, id: number, dir: string): AttachmentDTO {
	if (user.type === 'ai') throw new ServiceError(403, 'AI users cannot delete attachments');
	const row = getAttachment(db, id);
	db.delete(attachments).where(eq(attachments.id, id)).run();
	rmSync(attachmentPath(row, dir), { force: true });
	return row;
}

export function deleteTaskAttachments(db: Db, taskId: number, dir: string): void {
	const rows = db.select().from(attachments).where(eq(attachments.taskId, taskId)).all();
	db.delete(attachments).where(eq(attachments.taskId, taskId)).run();
	for (const row of rows) rmSync(attachmentPath(row, dir), { force: true });
}
