import { describe, it, expect } from 'vitest';
import { listTasks, createTask, parseTaskFilters, getTask, updateTask } from './tasks-service';
import { testDb, seedUsers } from './test-utils';

describe('createTask', () => {
	it('creates with defaults and rejects empty titles and bad enums', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: '  Buy wood  ' });
		expect(t.title).toBe('Buy wood');
		expect(t.status).toBe('Inbox');
		expect(t.createdBy).toBe(micha.id);
		expect(() => createTask(db, micha, { title: '   ' })).toThrowError('title is required');
		// @ts-expect-error invalid enum on purpose
		expect(() => createTask(db, micha, { title: 'x', status: 'Doing' })).toThrowError();
	});
});

describe('listTasks', () => {
	function seed(db: ReturnType<typeof testDb>) {
		const { micha, claude } = seedUsers(db);
		createTask(db, micha, { title: 'Low prio', priority: 'Low', assigneeId: micha.id });
		createTask(db, micha, { title: 'Urgent', priority: 'Super-High', assigneeId: claude.id });
		createTask(db, micha, { title: 'No prio, has due', dueDate: '2026-01-01' });
		createTask(db, micha, { title: 'Done already', status: 'Done' });
		return { micha, claude };
	}

	it('sorts by priority, then due date, then age', () => {
		const db = testDb();
		seed(db);
		expect(listTasks(db).map((t) => t.title)).toEqual([
			'Urgent', 'Low prio', 'No prio, has due', 'Done already'
		]);
	});

	it('filters by open, assignee (id or name, case-insensitive), q, status, limit', () => {
		const db = testDb();
		const { claude } = seed(db);
		expect(listTasks(db, { open: true }).map((t) => t.title)).not.toContain('Done already');
		expect(listTasks(db, { assignee: String(claude.id) })[0].title).toBe('Urgent');
		expect(listTasks(db, { assignee: 'claude' })[0].title).toBe('Urgent');
		expect(listTasks(db, { assignee: 'nobody' })).toEqual([]);
		expect(listTasks(db, { q: 'urg' }).map((t) => t.title)).toEqual(['Urgent']);
		expect(listTasks(db, { status: 'Done' }).map((t) => t.title)).toEqual(['Done already']);
		expect(listTasks(db, { limit: 2 })).toHaveLength(2);
	});
});

describe('parseTaskFilters', () => {
	it('parses url params', () => {
		const f = parseTaskFilters(
			new URLSearchParams('assignee=claude&project=3&open=true&q=wood&limit=50&offset=10')
		);
		expect(f).toEqual({ assignee: 'claude', project: 3, open: true, q: 'wood', limit: 50, offset: 10 });
		expect(parseTaskFilters(new URLSearchParams(''))).toEqual({});
	});
});

describe('getTask', () => {
	it('returns task with comments, 404 otherwise', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'With comments' });
		expect(getTask(db, t.id)).toEqual({ ...t, comments: [] });
		expect(() => getTask(db, 999)).toThrowError('task not found');
	});
});

describe('updateTask', () => {
	it('updates fields and bumps updatedAt', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Old' });
		const updated = updateTask(db, micha, t.id, { title: 'New', priority: 'High', hours: 2.5 });
		expect(updated.title).toBe('New');
		expect(updated.priority).toBe('High');
		expect(updated.hours).toBe(2.5);
		expect(updated.updatedAt >= t.updatedAt).toBe(true);
	});

	it('forbids AI users from setting Done', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const t = createTask(db, micha, { title: 'AI task', assigneeId: claude.id });
		expect(() => updateTask(db, claude, t.id, { status: 'Done' })).toThrowError(
			'AI users cannot set status to Done'
		);
		expect(updateTask(db, claude, t.id, { status: 'Review' }).status).toBe('Review');
		expect(updateTask(db, micha, t.id, { status: 'Done' }).status).toBe('Done');
	});

	it('stamps and clears completedAt on Done transitions', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Finish me' });
		const done = updateTask(db, micha, t.id, { status: 'Done' });
		expect(done.completedAt).not.toBeNull();
		const reopened = updateTask(db, micha, t.id, { status: 'To Do' });
		expect(reopened.completedAt).toBeNull();
	});

	it('ignores non-updatable fields and 404s on missing tasks', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Locked fields' });
		const updated = updateTask(db, micha, t.id, {
			title: 'Ok',
			// @ts-expect-error createdBy must be ignored
			createdBy: 999
		});
		expect(updated.createdBy).toBe(micha.id);
		expect(() => updateTask(db, micha, 999, { title: 'x' })).toThrowError('task not found');
	});
});
