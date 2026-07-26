import { describe, it, expect } from 'vitest';
import { listProjects, createProject, updateProject } from './projects-service';
import { listUsers } from './projects-service';
import { createLocation } from './locations-service';
import { createUser, type SafeUser } from './auth';
import { createTask } from './tasks-service';
import { testDb, seedUsers } from './test-utils';

describe('projects', () => {
	it('creates, lists, and archives projects', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const p = createProject(db, micha, { name: 'Website', color: '#3b82f6' });
		expect(p.archived).toBe(false);
		expect(() => createProject(db, micha, { name: ' ' })).toThrowError('name is required');
		const archived = updateProject(db, micha, p.id, { archived: true });
		expect(archived.archived).toBe(true);
		expect(listProjects(db, micha)).toHaveLength(1);
		expect(() => updateProject(db, micha, 99, { name: 'x' })).toThrowError('project not found');
	});

	it('returns the project unchanged on an empty patch', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const p = createProject(db, micha, { name: 'Website' });
		expect(updateProject(db, micha, p.id, {})).toEqual(p);
	});

	it('accepts a valid locationId and wikiRef, rejects unknown/invalid ones', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const loc = createLocation(db, { name: 'Schiffmühle' });
		const p = createProject(db, micha, {
			name: 'Teichbau',
			locationId: loc.id,
			wikiRef: 'Teichbau Schiffmühle'
		});
		expect(p.locationId).toBe(loc.id);
		expect(p.wikiRef).toBe('Teichbau Schiffmühle');
		expect(() => createProject(db, micha, { name: 'x', locationId: 999 })).toThrowError(
			'invalid locationId: location not found'
		);
		// @ts-expect-error wrong type on purpose
		expect(() => createProject(db, micha, { name: 'x', wikiRef: 5 })).toThrowError(
			'invalid wikiRef: must be a string'
		);
		const cleared = updateProject(db, micha, p.id, { locationId: null, wikiRef: null });
		expect(cleared.locationId).toBeNull();
		expect(cleared.wikiRef).toBeNull();
	});
});

describe('private projects (ownerId)', () => {
	it('listProjects hides foreign private projects from humans, shows all to AI and owner', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		createProject(db, micha, { name: 'Team' });
		createProject(db, micha, { name: 'Privat Micha', ownerId: micha.id });
		const names = (u: SafeUser) => listProjects(db, u).map((p) => p.name);
		expect(names(micha)).toEqual(['Privat Micha', 'Team']);
		expect(names(ulf)).toEqual(['Team']);
		expect(names(claude)).toEqual(['Privat Micha', 'Team']);
	});

	it('humans can only own private projects themselves; AI can assign any human owner', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		expect(() => createProject(db, micha, { name: 'X', ownerId: ulf.id })).toThrowError(
			'you can only own private projects yourself'
		);
		expect(createProject(db, claude, { name: 'Y', ownerId: micha.id }).ownerId).toBe(micha.id);
		expect(() => createProject(db, claude, { name: 'Z', ownerId: claude.id })).toThrowError(
			'invalid ownerId: must be an existing human user'
		); // AI cannot own
		expect(() => createProject(db, claude, { name: 'Z', ownerId: 999999 })).toThrowError(
			'invalid ownerId: must be an existing human user'
		);
	});

	it('only the owner can make a private project public; no owner transfer', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const p = createProject(db, micha, { name: 'P', ownerId: micha.id });
		expect(() => updateProject(db, claude, p.id, { ownerId: null })).toThrowError(
			'only the owner can make a private project public'
		);
		expect(() => updateProject(db, micha, p.id, { ownerId: ulf.id })).toThrowError(
			'owner cannot be transferred'
		);
		expect(updateProject(db, micha, p.id, { ownerId: null }).ownerId).toBeNull();
	});

	it('updateProject 404s foreign private projects (no existence leak)', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const p = createProject(db, micha, { name: 'P', ownerId: micha.id });
		expect(() => updateProject(db, ulf, p.id, { name: 'hijack' })).toThrowError(
			'project not found'
		);
	});

	it('converting a project to private requires no foreign human assignees', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const p = createProject(db, micha, { name: 'P' });
		createTask(db, micha, { title: 'ulfs task', projectId: p.id, assigneeId: ulf.id });
		expect(() => updateProject(db, micha, p.id, { ownerId: micha.id })).toThrowError(
			'project has tasks assigned to other users'
		);
	});

	it('converting a project with only AI-assigned tasks to private succeeds', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const p = createProject(db, micha, { name: 'P' });
		createTask(db, micha, { title: 'claudes task', projectId: p.id, assigneeId: claude.id });
		expect(updateProject(db, micha, p.id, { ownerId: micha.id }).ownerId).toBe(micha.id);
	});
});

describe('listUsers', () => {
	it('returns safe users only', () => {
		const db = testDb();
		seedUsers(db);
		const all = listUsers(db);
		expect(all.map((u) => u.name).sort()).toEqual(['Claude', 'Micha']);
		expect(all[0]).not.toHaveProperty('passwordHash');
	});
});
