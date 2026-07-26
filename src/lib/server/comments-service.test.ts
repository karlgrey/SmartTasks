import { describe, it, expect } from 'vitest';
import { addComment } from './comments-service';
import { createTask, getTask } from './tasks-service';
import { createProject } from './projects-service';
import { createUser } from './auth';
import { testDb, seedUsers } from './test-utils';

describe('addComment', () => {
	it('adds a comment, bumps the task updatedAt, and returns both', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Discuss' });
		const { comment, task } = addComment(db, claude, t.id, 'Result: done, see attachment.');
		expect(comment.authorId).toBe(claude.id);
		expect(comment.body).toBe('Result: done, see attachment.');
		expect(task.updatedAt >= t.updatedAt).toBe(true);
		expect(getTask(db, micha, t.id).comments).toHaveLength(1);
	});

	it('rejects empty bodies and missing tasks', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'x' });
		expect(() => addComment(db, micha, t.id, '  ')).toThrowError('body is required');
		expect(() => addComment(db, micha, 999, 'hi')).toThrowError('task not found');
	});

	it('rejects non-string bodies instead of throwing a TypeError', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'x' });
		// @ts-expect-error invalid type on purpose
		expect(() => addComment(db, micha, t.id, 5)).toThrowError('body is required');
	});
});

describe('private projects', () => {
	function privateSetup() {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const priv = createProject(db, micha, { name: 'Privat', ownerId: micha.id });
		const t = createTask(db, micha, { title: 'geheim', projectId: priv.id });
		return { db, micha, claude, ulf, priv, t };
	}

	it('rejects comments on tasks in foreign private projects with 404', () => {
		const { db, ulf, t } = privateSetup();
		expect(() => addComment(db, ulf, t.id, 'hi')).toThrowError('task not found');
	});
});
