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
	attachmentPath
} from './attachments-service';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

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
			addAttachment(db, users.micha, taskId, { ...f, mime: 'application/pdf' }, dir)
		).toThrowError(/unsupported/);
		expect(() =>
			addAttachment(db, users.micha, taskId, { ...f, data: Buffer.alloc(5 * 1024 * 1024 + 1) }, dir)
		).toThrowError(/too large/);
		expect(() => addAttachment(db, users.micha, taskId, { ...f, data: Buffer.alloc(0) }, dir)).toThrowError(
			/empty/
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
