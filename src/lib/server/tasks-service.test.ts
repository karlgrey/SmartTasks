import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { listTasks, createTask, parseTaskFilters, getTask, updateTask, deleteTask } from './tasks-service';
import { testDb, seedUsers } from './test-utils';
import { createUser } from './auth';
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
		const { micha } = seed(db);
		expect(listTasks(db, micha).map((t) => t.title)).toEqual([
			'Urgent', 'Low prio', 'No prio, has due', 'Done already'
		]);
	});

	it('filters by open, assignee (id or name, case-insensitive), q, status, limit', () => {
		const db = testDb();
		const { micha, claude } = seed(db);
		expect(listTasks(db, micha, { open: true }).map((t) => t.title)).not.toContain('Done already');
		expect(listTasks(db, micha, { assignee: String(claude.id) })[0].title).toBe('Urgent');
		expect(listTasks(db, micha, { assignee: 'claude' })[0].title).toBe('Urgent');
		expect(listTasks(db, micha, { assignee: 'nobody' })).toEqual([]);
		expect(listTasks(db, micha, { q: 'urg' }).map((t) => t.title)).toEqual(['Urgent']);
		expect(listTasks(db, micha, { status: 'Done' }).map((t) => t.title)).toEqual(['Done already']);
		expect(listTasks(db, micha, { limit: 2 })).toHaveLength(2);
	});

	it('q matches ticket ids: exact for plain numbers, prefix for the #-form', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const now = new Date().toISOString();
		const insert = (id: number, title: string) =>
			db.insert(tasks).values({ id, title, createdBy: micha.id, createdAt: now, updatedAt: now }).run();
		insert(18, 'Zaun bauen');
		insert(186, 'Anderes');
		insert(200, 'Rechnung 186 prüfen');
		// plain number: exact id hit PLUS normal text hits
		expect(listTasks(db, micha, { q: '186' }).map((t) => t.id).sort()).toEqual([186, 200]);
		// #-form: exact
		expect(listTasks(db, micha, { q: '#186' }).map((t) => t.id)).toEqual([186]);
		// #-form: id prefix (incremental typing)
		expect(listTasks(db, micha, { q: '#18' }).map((t) => t.id).sort()).toEqual([18, 186]);
		// plain number does not prefix-match ids (200 matches via '18' in its title)
		expect(listTasks(db, micha, { q: '18' }).map((t) => t.id).sort()).toEqual([18, 200]);
	});

	it('orders the Done column by most recently completed, not boardOrder', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const older = createTask(db, micha, { title: 'Older done', status: 'Done', priority: 'Super-High' });
		const newer = createTask(db, micha, { title: 'Newer done', status: 'Done', priority: 'Low' });
		db.update(tasks).set({ completedAt: '2026-01-01T00:00:00.000Z' }).where(eq(tasks.id, older.id)).run();
		db.update(tasks).set({ completedAt: '2026-02-01T00:00:00.000Z' }).where(eq(tasks.id, newer.id)).run();
		expect(listTasks(db, micha, { status: 'Done', limit: 1 })[0].title).toBe('Newer done');
	});

	it('filters by location via the task project', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const schiff = createLocation(db, { name: 'Schiffmühle' });
		const teich = createProject(db, micha, { name: 'Teichbau', locationId: schiff.id });
		const other = createProject(db, micha, { name: 'Elsewhere' });
		createTask(db, micha, { title: 'Teich ausheben', projectId: teich.id });
		createTask(db, micha, { title: 'Other work', projectId: other.id });
		createTask(db, micha, { title: 'No project' });
		expect(listTasks(db, micha, { location: schiff.id }).map((t) => t.title)).toEqual(['Teich ausheben']);
		expect(listTasks(db, micha, { location: schiff.id, open: true })).toHaveLength(1);
		expect(listTasks(db, micha, { location: 999 })).toEqual([]);
	});

	it('filters by today: open tasks due today or earlier (Europe/Berlin), no dueDate excluded', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-25T10:00:00Z')); // 12:00 CEST, still the 25th in Berlin
		const db = testDb();
		const { micha } = seedUsers(db);
		const overdue = createTask(db, micha, { title: 'Overdue', dueDate: '2026-07-20' });
		const dueToday = createTask(db, micha, { title: 'Due today', dueDate: '2026-07-25' });
		createTask(db, micha, { title: 'Due tomorrow', dueDate: '2026-07-26' });
		createTask(db, micha, { title: 'No due date' });
		createTask(db, micha, { title: 'Done, due today', dueDate: '2026-07-25', status: 'Done' });
		expect(
			listTasks(db, micha, { today: true })
				.map((t) => t.id)
				.sort((a, b) => a - b)
		).toEqual([overdue.id, dueToday.id].sort((a, b) => a - b));
		vi.useRealTimers();
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

	it('parses the today param', () => {
		expect(parseTaskFilters(new URLSearchParams('today=true'))).toEqual({ today: true });
		expect(parseTaskFilters(new URLSearchParams('today=false'))).toEqual({});
	});
});

describe('getTask', () => {
	it('returns task with comments and statusEvents, 404 otherwise', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'With comments' });
		const detail = getTask(db, micha, t.id);
		expect(detail.comments).toEqual([]);
		expect(detail.statusEvents).toHaveLength(1);
		expect(detail.statusEvents[0]).toMatchObject({
			fromStatus: null,
			toStatus: 'Inbox',
			userId: micha.id
		});
		expect(() => getTask(db, micha, 999)).toThrowError('task not found');
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
		let detail = getTask(db, micha, t.id);
		expect(detail.statusEvents).toHaveLength(1);
		expect(detail.statusEvents[0]).toMatchObject({
			fromStatus: null,
			toStatus: 'To Do',
			userId: micha.id,
			createdAt: t.createdAt
		});

		const updated = updateTask(db, claude, t.id, { status: 'In Progress' });
		detail = getTask(db, micha, t.id);
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
		expect(getTask(db, micha, t.id).statusEvents).toHaveLength(1);
	});

	it('orders same-timestamp events by insertion order, not just createdAt', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Fast mover' });
		updateTask(db, micha, t.id, { status: 'To Do' });
		updateTask(db, micha, t.id, { status: 'Review' });
		const detail = getTask(db, micha, t.id);
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
		expect(() => getTask(db, micha, t.id)).toThrowError('task not found');
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
		expect(getTask(db, micha, task.id).attachments).toEqual([a]);
		deleteTask(db, micha, task.id, dir);
		expect(existsSync(attachmentPath(a, dir))).toBe(false);
		expect(() => getTask(db, micha, task.id)).toThrowError(/not found/);
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('private projects — task visibility', () => {
	function privateSetup() {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const priv = createProject(db, micha, { name: 'Privat', ownerId: micha.id });
		const t = createTask(db, micha, { title: 'geheim', projectId: priv.id });
		return { db, micha, claude, ulf, priv, t };
	}

	it('hides tasks of foreign private projects from list, search and today', () => {
		const { db, micha, ulf, claude } = privateSetup();
		expect(listTasks(db, micha).map((t) => t.title)).toContain('geheim');
		expect(listTasks(db, ulf)).toHaveLength(0);
		expect(listTasks(db, ulf, { q: 'geheim' })).toHaveLength(0);
		expect(listTasks(db, claude).map((t) => t.title)).toContain('geheim');
	});

	it('getTask/updateTask/deleteTask answer 404 for non-owners', () => {
		const { db, ulf, t } = privateSetup();
		expect(() => getTask(db, ulf, t.id)).toThrowError('task not found');
		expect(() => updateTask(db, ulf, t.id, { title: 'x' })).toThrowError('task not found');
		expect(() => deleteTask(db, ulf, t.id)).toThrowError('task not found');
	});

	it('creating into an invisible private project fails like a missing project', () => {
		const { db, ulf, priv } = privateSetup();
		expect(() => createTask(db, ulf, { title: 'x', projectId: priv.id }))
			.toThrowError('invalid projectId: project not found');
	});

	it('enforces the assignee rule in private projects (create, update, move-in)', () => {
		const { db, micha, claude, ulf, priv } = privateSetup();
		const err = 'tasks in a private project can only be assigned to the owner or an AI user';
		expect(() => createTask(db, micha, { title: 'x', projectId: priv.id, assigneeId: ulf.id }))
			.toThrowError(err);
		expect(createTask(db, micha, { title: 'ok1', projectId: priv.id, assigneeId: micha.id }).id).toBeGreaterThan(0);
		expect(createTask(db, micha, { title: 'ok2', projectId: priv.id, assigneeId: claude.id }).id).toBeGreaterThan(0);
		const pub = createTask(db, micha, { title: 'wandert', assigneeId: ulf.id });
		expect(() => updateTask(db, micha, pub.id, { projectId: priv.id })).toThrowError(err);
	});
});
