import { describe, it, expect } from 'vitest';
import { createDb } from './index';
import { tasks, users } from './schema';

describe('db', () => {
	it('creates schema and round-trips a task', () => {
		const db = createDb(':memory:');
		const user = db
			.insert(users)
			.values({ name: 'Micha', email: 'm@test.dev', type: 'human' })
			.returning()
			.get();
		const now = new Date().toISOString();
		const task = db
			.insert(tasks)
			.values({ title: 'First task', createdBy: user.id, createdAt: now, updatedAt: now })
			.returning()
			.get();
		expect(task.id).toBe(1);
		expect(task.status).toBe('Inbox');
		expect(task.description).toBe('');
		expect(task.completedAt).toBeNull();
	});
});
