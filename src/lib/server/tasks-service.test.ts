import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { listTasks, createTask, parseTaskFilters, getTask, updateTask, deleteTask } from './tasks-service';
import { testDb, seedUsers } from './test-utils';
import { tasks } from './db/schema';
import { createLocation } from './locations-service';
import { createProject } from './projects-service';
import { addComment } from './comments-service';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addAttachment, attachmentPath } from './attachments-service';

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

	it('allows AI users to create tasks directly in Done (creator rule)', () => {
		const db = testDb();
		const { claude } = seedUsers(db);
		const doc = createTask(db, claude, { title: 'x', status: 'Done' });
		expect(doc.status).toBe('Done');
		expect(doc.completedAt).not.toBeNull();
		expect(createTask(db, claude, { title: 'x', status: 'Review' }).status).toBe('Review');
	});

	it('stamps completedAt when created directly in Done', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const done = createTask(db, micha, { title: 'Already done', status: 'Done' });
		expect(done.completedAt).not.toBeNull();
		const open = createTask(db, micha, { title: 'Not done' });
		expect(open.completedAt).toBeNull();
	});

	it('validates payload field types', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		// @ts-expect-error invalid type on purpose
		expect(() => createTask(db, micha, { title: 123 })).toThrowError(
			'invalid title: must be a string'
		);
		expect(() =>
			// @ts-expect-error invalid type on purpose
			createTask(db, micha, { title: 'x', hours: 'abc' })
		).toThrowError('invalid hours: must be a number');
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

	it('orders the Done column by most recently completed, not boardOrder', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const older = createTask(db, micha, { title: 'Older done', status: 'Done', priority: 'Super-High' });
		const newer = createTask(db, micha, { title: 'Newer done', status: 'Done', priority: 'Low' });
		db.update(tasks).set({ completedAt: '2026-01-01T00:00:00.000Z' }).where(eq(tasks.id, older.id)).run();
		db.update(tasks).set({ completedAt: '2026-02-01T00:00:00.000Z' }).where(eq(tasks.id, newer.id)).run();
		expect(listTasks(db, { status: 'Done', limit: 1 })[0].title).toBe('Newer done');
	});

	it('filters by location via the task project', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const schiff = createLocation(db, { name: 'Schiffmühle' });
		const teich = createProject(db, { name: 'Teichbau', locationId: schiff.id });
		const other = createProject(db, { name: 'Elsewhere' });
		createTask(db, micha, { title: 'Teich ausheben', projectId: teich.id });
		createTask(db, micha, { title: 'Other work', projectId: other.id });
		createTask(db, micha, { title: 'No project' });
		expect(listTasks(db, { location: schiff.id }).map((t) => t.title)).toEqual(['Teich ausheben']);
		expect(listTasks(db, { location: schiff.id, open: true })).toHaveLength(1);
		expect(listTasks(db, { location: 999 })).toEqual([]);
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

	it('parses the location param', () => {
		expect(parseTaskFilters(new URLSearchParams('location=7'))).toEqual({ location: 7 });
	});
});

describe('getTask', () => {
	it('returns task with comments and statusEvents, 404 otherwise', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'With comments' });
		const detail = getTask(db, t.id);
		expect(detail.comments).toEqual([]);
		expect(detail.statusEvents).toHaveLength(1);
		expect(detail.statusEvents[0]).toMatchObject({
			fromStatus: null,
			toStatus: 'Inbox',
			userId: micha.id
		});
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
			'AI users can only set Done on tasks they created'
		);
		expect(updateTask(db, claude, t.id, { status: 'Review' }).status).toBe('Review');
		expect(updateTask(db, micha, t.id, { status: 'Done' }).status).toBe('Done');
	});

	it('lets AI users set Done on tasks they created themselves, regardless of assignee', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const doc = createTask(db, claude, { title: '[Doku] sent mail', assigneeId: micha.id });
		const done = updateTask(db, claude, doc.id, { status: 'Done' });
		expect(done.status).toBe('Done');
		expect(done.assigneeId).toBe(micha.id);
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

	it('validates payload field types', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'x' });
		expect(() =>
			// @ts-expect-error invalid type on purpose
			updateTask(db, micha, t.id, { hours: 'abc' })
		).toThrowError('invalid hours: must be a number');
	});
});

describe('status events', () => {
	it('records creation and real status changes with actor and timestamps', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Track me', status: 'To Do' });
		let detail = getTask(db, t.id);
		expect(detail.statusEvents).toHaveLength(1);
		expect(detail.statusEvents[0]).toMatchObject({
			fromStatus: null,
			toStatus: 'To Do',
			userId: micha.id,
			createdAt: t.createdAt
		});

		const updated = updateTask(db, claude, t.id, { status: 'In Progress' });
		detail = getTask(db, t.id);
		expect(detail.statusEvents).toHaveLength(2);
		expect(detail.statusEvents[1]).toMatchObject({
			fromStatus: 'To Do',
			toStatus: 'In Progress',
			userId: claude.id,
			createdAt: updated.updatedAt
		});
	});

	it('writes no event for same-status or non-status patches', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Quiet' });
		updateTask(db, micha, t.id, { status: 'Inbox' });
		updateTask(db, micha, t.id, { title: 'Still quiet' });
		expect(getTask(db, t.id).statusEvents).toHaveLength(1);
	});

	it('orders same-timestamp events by insertion order, not just createdAt', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Fast mover' });
		updateTask(db, micha, t.id, { status: 'To Do' });
		updateTask(db, micha, t.id, { status: 'Review' });
		const detail = getTask(db, t.id);
		expect(detail.statusEvents.map((e) => e.toStatus)).toEqual(['Inbox', 'To Do', 'Review']);
	});
});

describe('deleteTask', () => {
	it('cascades comments and events, humans only, 404 on missing', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Doomed' });
		addComment(db, micha, t.id, 'bye');
		updateTask(db, micha, t.id, { status: 'Done' });
		expect(() => deleteTask(db, claude, t.id)).toThrowError('AI users cannot delete tasks');
		const deleted = deleteTask(db, micha, t.id);
		expect(deleted.id).toBe(t.id);
		expect(() => getTask(db, t.id)).toThrowError('task not found');
		expect(() => deleteTask(db, micha, t.id)).toThrowError('task not found');
	});

	it('getTask includes attachments; deleteTask removes their files', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const dir = mkdtempSync(join(tmpdir(), 'st-uploads-'));
		const task = createTask(db, micha, { title: 'with photo' });
		const a = addAttachment(
			db, micha, task.id,
			{ filename: 'p.png', mime: 'image/png', data: Buffer.from([1, 2, 3]) },
			dir
		);
		expect(getTask(db, task.id).attachments).toEqual([a]);
		deleteTask(db, micha, task.id, dir);
		expect(existsSync(attachmentPath(a, dir))).toBe(false);
		expect(() => getTask(db, task.id)).toThrowError(/not found/);
		rmSync(dir, { recursive: true, force: true });
	});
});
