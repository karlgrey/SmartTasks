import { describe, it, expect } from 'vitest';
import { listProjects, createProject, updateProject } from './projects-service';
import { listUsers } from './projects-service';
import { testDb, seedUsers } from './test-utils';

describe('projects', () => {
	it('creates, lists, and archives projects', () => {
		const db = testDb();
		const p = createProject(db, { name: 'Website', color: '#3b82f6' });
		expect(p.archived).toBe(false);
		expect(() => createProject(db, { name: ' ' })).toThrowError('name is required');
		const archived = updateProject(db, p.id, { archived: true });
		expect(archived.archived).toBe(true);
		expect(listProjects(db)).toHaveLength(1);
		expect(() => updateProject(db, 99, { name: 'x' })).toThrowError('project not found');
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
