import { describe, it, expect } from 'vitest';
import { createDb } from './index';
import { tasks, users, locations, projects, statusEvents } from './schema';
import { testDb, seedUsers } from '../test-utils';

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

	it('supports locations and project location/wikiRef', () => {
		const db = createDb(':memory:');
		const loc = db.insert(locations).values({ name: 'Schiffmühle' }).returning().get();
		expect(loc.archived).toBe(false);
		const project = db
			.insert(projects)
			.values({ name: 'Teichbau', locationId: loc.id, wikiRef: 'Teichbau Schiffmühle' })
			.returning()
			.get();
		expect(project.locationId).toBe(loc.id);
		expect(project.wikiRef).toBe('Teichbau Schiffmühle');
	});

	it('stores status events', () => {
		const db = createDb(':memory:');
		const user = db
			.insert(users)
			.values({ name: 'M', email: 'm@t.dev', type: 'human' })
			.returning()
			.get();
		const now = new Date().toISOString();
		const task = db
			.insert(tasks)
			.values({ title: 't', createdBy: user.id, createdAt: now, updatedAt: now })
			.returning()
			.get();
		const ev = db
			.insert(statusEvents)
			.values({ taskId: task.id, userId: user.id, fromStatus: null, toStatus: 'Inbox', createdAt: now })
			.returning()
			.get();
		expect(ev.fromStatus).toBeNull();
		expect(ev.toStatus).toBe('Inbox');
	});

	it('projects have a nullable ownerId (private projects)', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const pub = db.insert(projects).values({ name: 'Team' }).returning().get();
		expect(pub.ownerId).toBeNull();
		const priv = db.insert(projects).values({ name: 'Privat', ownerId: micha.id }).returning().get();
		expect(priv.ownerId).toBe(micha.id);
	});
});
