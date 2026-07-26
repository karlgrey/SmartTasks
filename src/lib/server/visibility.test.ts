import { describe, it, expect } from 'vitest';
import {
	canSeeProject, taskVisibilityCond, projectVisibilityCond,
	assertTaskVisible, assertProjectUsable
} from './visibility';
import { testDb, seedUsers } from './test-utils';
import { createUser } from './auth';
import { projects } from './db/schema';

describe('canSeeProject', () => {
	const pub = { ownerId: null };
	it('humans see public and own private projects, not foreign ones', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const other = createUser(db, { name: 'Other', type: 'human' });
		expect(canSeeProject(micha, pub)).toBe(true);
		expect(canSeeProject(micha, { ownerId: micha.id })).toBe(true);
		expect(canSeeProject(micha, { ownerId: other.id })).toBe(false);
		expect(canSeeProject(claude, { ownerId: other.id })).toBe(true); // AI sees all
	});
});

describe('visibility conds', () => {
	it('are undefined for AI users (no filtering)', () => {
		const db = testDb();
		const { claude } = seedUsers(db);
		expect(taskVisibilityCond(claude)).toBeUndefined();
		expect(projectVisibilityCond(claude)).toBeUndefined();
	});
});

describe('assertTaskVisible / assertProjectUsable', () => {
	it('404s a task in a foreign private project, passes own/public/projectless', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const other = createUser(db, { name: 'Other', type: 'human' });
		const foreign = db.insert(projects).values({ name: 'P', ownerId: other.id }).returning().get();
		expect(() => assertTaskVisible(db, micha, { projectId: foreign.id })).toThrowError('task not found');
		expect(() => assertTaskVisible(db, micha, { projectId: null })).not.toThrow();
		expect(() => assertTaskVisible(db, claude, { projectId: foreign.id })).not.toThrow();
	});
	it('assertProjectUsable: 400 for missing or foreign-private, returns row otherwise', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const other = createUser(db, { name: 'Other2', type: 'human' });
		const own = db.insert(projects).values({ name: 'Mine', ownerId: micha.id }).returning().get();
		const foreign = db.insert(projects).values({ name: 'F', ownerId: other.id }).returning().get();
		expect(assertProjectUsable(db, micha, null)).toBeNull();
		expect(assertProjectUsable(db, micha, own.id)?.id).toBe(own.id);
		expect(() => assertProjectUsable(db, micha, foreign.id)).toThrowError('invalid projectId: project not found');
		expect(() => assertProjectUsable(db, micha, 999999)).toThrowError('invalid projectId: project not found');
		expect(assertProjectUsable(db, claude, foreign.id)?.id).toBe(foreign.id);
	});
});
