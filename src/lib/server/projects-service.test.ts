import { describe, it, expect } from 'vitest';
import { listProjects, createProject, updateProject } from './projects-service';
import { listUsers } from './projects-service';
import { createLocation } from './locations-service';
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

	it('returns the project unchanged on an empty patch', () => {
		const db = testDb();
		const p = createProject(db, { name: 'Website' });
		expect(updateProject(db, p.id, {})).toEqual(p);
	});

	it('accepts a valid locationId and wikiRef, rejects unknown/invalid ones', () => {
		const db = testDb();
		const loc = createLocation(db, { name: 'Schiffmühle' });
		const p = createProject(db, { name: 'Teichbau', locationId: loc.id, wikiRef: 'Teichbau Schiffmühle' });
		expect(p.locationId).toBe(loc.id);
		expect(p.wikiRef).toBe('Teichbau Schiffmühle');
		expect(() => createProject(db, { name: 'x', locationId: 999 })).toThrowError(
			'invalid locationId: location not found'
		);
		// @ts-expect-error wrong type on purpose
		expect(() => createProject(db, { name: 'x', wikiRef: 5 })).toThrowError(
			'invalid wikiRef: must be a string'
		);
		const cleared = updateProject(db, p.id, { locationId: null, wikiRef: null });
		expect(cleared.locationId).toBeNull();
		expect(cleared.wikiRef).toBeNull();
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
