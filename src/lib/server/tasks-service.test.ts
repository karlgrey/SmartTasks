import { describe, it, expect } from 'vitest';
import { listTasks, createTask, parseTaskFilters } from './tasks-service';
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
