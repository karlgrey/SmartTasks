import { describe, it, expect, beforeEach } from 'vitest';
import { testDb, seedUsers } from './test-utils';
import { createProject } from './projects-service';
import { createTask, deleteTask } from './tasks-service';
import {
	listDocuments,
	createDocument,
	getDocument,
	updateDocument,
	deleteDocument,
	linkTask,
	unlinkTask,
	listDocRefsForTask,
	parseDocFilters
} from './documents-service';

describe('documents-service', () => {
	let db: ReturnType<typeof testDb>;
	let users: ReturnType<typeof seedUsers>;

	beforeEach(() => {
		db = testDb();
		users = seedUsers(db);
	});

	it('creates a doc (title required, body/project optional)', () => {
		const d = createDocument(db, users.micha, { title: '  SOP  ' });
		expect(d.title).toBe('SOP');
		expect(d.body).toBe('');
		expect(d.projectId).toBe(null);
		expect(d.createdBy).toBe(users.micha.id);
		expect(d.createdAt).toBe(d.updatedAt);
		expect(() => createDocument(db, users.micha, { title: '   ' })).toThrowError(/title is required/);
	});

	it('AI users may create and edit docs', () => {
		const d = createDocument(db, users.claude, { title: 'Agent note', body: 'hi' });
		expect(d.createdBy).toBe(users.claude.id);
		const upd = updateDocument(db, users.claude, d.id, { body: 'edited' });
		expect(upd.body).toBe('edited');
	});

	it('updates title/body/projectId and bumps updatedAt', async () => {
		const project = createProject(db, { name: 'Website' });
		const d = createDocument(db, users.micha, { title: 'A' });
		await new Promise((r) => setTimeout(r, 5));
		const upd = updateDocument(db, users.micha, d.id, { title: 'B', projectId: project.id });
		expect(upd.title).toBe('B');
		expect(upd.projectId).toBe(project.id);
		expect(upd.updatedAt >= d.updatedAt).toBe(true);
		// clearing the project
		expect(updateDocument(db, users.micha, d.id, { projectId: null }).projectId).toBe(null);
	});

	it('rejects empty title on update, 404 on unknown id', () => {
		const d = createDocument(db, users.micha, { title: 'A' });
		expect(() => updateDocument(db, users.micha, d.id, { title: ' ' })).toThrowError(/title is required/);
		expect(() => updateDocument(db, users.micha, 999, { title: 'x' })).toThrowError(/not found/);
		expect(() => getDocument(db, 999)).toThrowError(/not found/);
	});

	it('delete is human-only (AI → 403) and cleans up link rows', () => {
		const task = createTask(db, users.micha, { title: 'T' });
		const d = createDocument(db, users.micha, { title: 'A' });
		linkTask(db, users.micha, d.id, task.id);
		expect(() => deleteDocument(db, users.claude, d.id)).toThrowError(/AI users/);
		deleteDocument(db, users.micha, d.id);
		expect(() => getDocument(db, d.id)).toThrowError(/not found/);
		// link row gone → task shows no docs
		expect(listDocRefsForTask(db, task.id)).toEqual([]);
	});

	it('lists newest-updated first, filters by project, searches title AND body', async () => {
		const p1 = createProject(db, { name: 'P1' });
		const a = createDocument(db, users.micha, { title: 'Alpha guide', body: 'nothing', projectId: p1.id });
		await new Promise((r) => setTimeout(r, 5));
		const b = createDocument(db, users.micha, { title: 'Beta', body: 'mentions kanban here' });

		// newest-updated first
		const all = listDocuments(db, {});
		expect(all.map((d) => d.id)).toEqual([b.id, a.id]);

		// project filter
		expect(listDocuments(db, { project: p1.id }).map((d) => d.id)).toEqual([a.id]);

		// search matches title
		expect(listDocuments(db, { q: 'alpha' }).map((d) => d.id)).toEqual([a.id]);
		// search matches body
		expect(listDocuments(db, { q: 'kanban' }).map((d) => d.id)).toEqual([b.id]);
		// no match
		expect(listDocuments(db, { q: 'zzz' })).toEqual([]);
	});

	it('links tasks idempotently and exposes both directions', () => {
		const t1 = createTask(db, users.micha, { title: 'T1' });
		const t2 = createTask(db, users.micha, { title: 'T2' });
		const d = createDocument(db, users.micha, { title: 'A' });

		linkTask(db, users.micha, d.id, t1.id);
		linkTask(db, users.micha, d.id, t1.id); // idempotent, no throw / no dup
		linkTask(db, users.claude, d.id, t2.id); // AI may link

		const detail = getDocument(db, d.id);
		expect(detail.tasks.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
		expect(detail.tasks[0]).toHaveProperty('status');

		expect(listDocRefsForTask(db, t1.id)).toEqual([{ id: d.id, title: 'A' }]);

		unlinkTask(db, users.micha, d.id, t1.id);
		expect(getDocument(db, d.id).tasks.map((t) => t.id)).toEqual([t2.id]);
	});

	it('link/unlink validate that both entities exist', () => {
		const d = createDocument(db, users.micha, { title: 'A' });
		const task = createTask(db, users.micha, { title: 'T' });
		expect(() => linkTask(db, users.micha, d.id, 999)).toThrowError(/task not found/);
		expect(() => linkTask(db, users.micha, 999, task.id)).toThrowError(/document not found/);
	});

	it('deleting a linked task cleans up the link (no FK violation)', () => {
		const task = createTask(db, users.micha, { title: 'T' });
		const d = createDocument(db, users.micha, { title: 'A' });
		linkTask(db, users.micha, d.id, task.id);
		expect(() => deleteTask(db, users.micha, task.id)).not.toThrow();
		expect(getDocument(db, d.id).tasks).toEqual([]);
	});

	it('parseDocFilters reads project, q, limit, offset', () => {
		const f = parseDocFilters(new URLSearchParams('project=3&q=hello&limit=10&offset=5'));
		expect(f).toEqual({ project: 3, q: 'hello', limit: 10, offset: 5 });
		expect(parseDocFilters(new URLSearchParams(''))).toEqual({});
	});
});
