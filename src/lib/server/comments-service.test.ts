import { describe, it, expect } from 'vitest';
import { addComment } from './comments-service';
import { createTask, getTask } from './tasks-service';
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
		expect(getTask(db, t.id).comments).toHaveLength(1);
	});

	it('rejects empty bodies and missing tasks', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'x' });
		expect(() => addComment(db, micha, t.id, '  ')).toThrowError('body is required');
		expect(() => addComment(db, micha, 999, 'hi')).toThrowError('task not found');
	});
});
