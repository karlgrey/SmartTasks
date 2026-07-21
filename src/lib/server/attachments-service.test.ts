import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb, seedUsers } from './test-utils';
import { createTask } from './tasks-service';
import {
	addAttachment,
	getAttachment,
	deleteAttachment,
	deleteTaskAttachments,
	attachmentPath,
	contentDisposition
} from './attachments-service';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const pdf = Buffer.from('%PDF-1.4\n%fake');

describe('attachments-service', () => {
	let db: ReturnType<typeof testDb>;
	let users: ReturnType<typeof seedUsers>;
	let dir: string;
	let taskId: number;

	beforeEach(() => {
		db = testDb();
		users = seedUsers(db);
		dir = mkdtempSync(join(tmpdir(), 'st-uploads-'));
		taskId = createTask(db, users.micha, { title: 'T' }).id;
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('stores file + row and serves metadata', () => {
		const a = addAttachment(db, users.micha, taskId, { filename: 'p.png', mime: 'image/png', data: png }, dir);
		expect(a.taskId).toBe(taskId);
		expect(a.size).toBe(png.length);
		expect(existsSync(attachmentPath(a, dir))).toBe(true);
		expect(getAttachment(db, a.id)).toEqual(a);
	});

	it('rejects AI users', () => {
		expect(() =>
			addAttachment(db, users.claude, taskId, { filename: 'p.png', mime: 'image/png', data: png }, dir)
		).toThrowError(/AI users/);
	});

	it('rejects unknown task, bad mime, oversize, empty file', () => {
		const f = { filename: 'p.png', mime: 'image/png', data: png };
		expect(() => addAttachment(db, users.micha, 999, f, dir)).toThrowError(/task not found/);
		expect(() =>
			addAttachment(db, users.micha, taskId, { ...f, filename: 'virus.exe', mime: 'application/octet-stream' }, dir)
		).toThrowError(/unsupported/);
		expect(() =>
			addAttachment(db, users.micha, taskId, { ...f, data: Buffer.alloc(5 * 1024 * 1024 + 1) }, dir)
		).toThrowError(/too large/);
		expect(() => addAttachment(db, users.micha, taskId, { ...f, data: Buffer.alloc(0) }, dir)).toThrowError(
			/empty/
		);
	});

	it('rejects filename/MIME mismatch', () => {
		expect(() =>
			addAttachment(db, users.micha, taskId, { filename: 'report.txt', mime: 'application/pdf', data: pdf }, dir)
		).toThrowError(/extension does not match/);
	});

	it('accepts PDF and other whitelisted v2 document types (#201)', () => {
		const a = addAttachment(
			db,
			users.micha,
			taskId,
			{ filename: 'report.pdf', mime: 'application/pdf', data: pdf },
			dir
		);
		expect(a.mime).toBe('application/pdf');
		expect(existsSync(attachmentPath(a, dir))).toBe(true);
		expect(attachmentPath(a, dir).endsWith('.pdf')).toBe(true);

		for (const [mime, filename] of [
			['text/plain', 'notes.txt'],
			['text/csv', 'export.csv'],
			['application/zip', 'archive.zip'],
			['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc.docx'],
			['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'sheet.xlsx']
		] as const) {
			const row = addAttachment(db, users.micha, taskId, { filename, mime, data: pdf }, dir);
			expect(row.mime).toBe(mime);
			expect(existsSync(attachmentPath(row, dir))).toBe(true);
		}
	});

	it('contentDisposition: inline for images, attachment+filename for everything else', () => {
		expect(contentDisposition('p.png', 'image/png')).toBe('inline');
		expect(contentDisposition('report.pdf', 'application/pdf')).toBe(
			`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
		);
		expect(contentDisposition('Übergabe.pdf', 'application/pdf')).toContain(
			"filename*=UTF-8''%C3%9Cbergabe.pdf"
		);
	});

	it('deleteAttachment removes row + file, humans only', () => {
		const a = addAttachment(db, users.micha, taskId, { filename: 'p.png', mime: 'image/png', data: png }, dir);
		expect(() => deleteAttachment(db, users.claude, a.id, dir)).toThrowError(/AI users/);
		deleteAttachment(db, users.micha, a.id, dir);
		expect(() => getAttachment(db, a.id)).toThrowError(/not found/);
		expect(existsSync(attachmentPath(a, dir))).toBe(false);
	});

	it('deleteTaskAttachments removes all rows + files for a task', () => {
		const a1 = addAttachment(db, users.micha, taskId, { filename: 'a.png', mime: 'image/png', data: png }, dir);
		const a2 = addAttachment(db, users.micha, taskId, { filename: 'b.jpg', mime: 'image/jpeg', data: png }, dir);
		deleteTaskAttachments(db, taskId, dir);
		expect(() => getAttachment(db, a1.id)).toThrowError(/not found/);
		expect(existsSync(attachmentPath(a2, dir))).toBe(false);
	});
});
