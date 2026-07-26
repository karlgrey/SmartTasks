import { eq, and, asc, ne } from 'drizzle-orm';
import type { Db } from './db';
import { projects, users, locations, tasks } from './db/schema';
import { ServiceError } from './errors';
import { toSafeUser, type SafeUser } from './auth';
import { projectVisibilityCond, canSeeProject } from './visibility';
import type { ProjectDTO } from '$lib/types';

export function listProjects(db: Db, user: SafeUser): ProjectDTO[] {
	return db
		.select()
		.from(projects)
		.where(projectVisibilityCond(user))
		.orderBy(asc(projects.name))
		.all();
}

function assertOwnerId(db: Db, user: SafeUser, ownerId: number | null | undefined): void {
	if (ownerId === null || ownerId === undefined) return;
	if (typeof ownerId !== 'number') throw new ServiceError(400, 'invalid ownerId: must be a number');
	const owner = db.select().from(users).where(eq(users.id, ownerId)).get();
	if (!owner || owner.type !== 'human')
		throw new ServiceError(400, 'invalid ownerId: must be an existing human user');
	if (user.type === 'human' && ownerId !== user.id)
		throw new ServiceError(403, 'you can only own private projects yourself');
}

// no task may have a human assignee other than the new owner
function assertNoForeignAssignees(db: Db, projectId: number, ownerId: number): void {
	const foreign = db
		.select({ id: tasks.id })
		.from(tasks)
		.innerJoin(users, eq(users.id, tasks.assigneeId))
		.where(and(eq(tasks.projectId, projectId), eq(users.type, 'human'), ne(users.id, ownerId)))
		.get();
	if (foreign) throw new ServiceError(400, 'project has tasks assigned to other users');
}

function assertLocationId(db: Db, locationId: number | null | undefined): void {
	if (locationId === null || locationId === undefined) return;
	if (typeof locationId !== 'number')
		throw new ServiceError(400, 'invalid locationId: must be a number');
	const loc = db.select().from(locations).where(eq(locations.id, locationId)).get();
	if (!loc) throw new ServiceError(400, 'invalid locationId: location not found');
}

function assertWikiRef(wikiRef: unknown): void {
	if (wikiRef !== null && wikiRef !== undefined && typeof wikiRef !== 'string')
		throw new ServiceError(400, 'invalid wikiRef: must be a string');
}

export function createProject(
	db: Db,
	user: SafeUser,
	input: {
		name: string;
		color?: string;
		locationId?: number | null;
		wikiRef?: string | null;
		ownerId?: number | null;
	}
): ProjectDTO {
	if (!input.name?.trim()) throw new ServiceError(400, 'name is required');
	assertLocationId(db, input.locationId);
	assertWikiRef(input.wikiRef);
	assertOwnerId(db, user, input.ownerId);
	return db
		.insert(projects)
		.values({
			name: input.name.trim(),
			color: input.color ?? '#6b7280',
			locationId: input.locationId ?? null,
			wikiRef: input.wikiRef ?? null,
			ownerId: input.ownerId ?? null
		})
		.returning()
		.get();
}

export function updateProject(
	db: Db,
	user: SafeUser,
	id: number,
	patch: {
		name?: string;
		color?: string;
		archived?: boolean;
		locationId?: number | null;
		wikiRef?: string | null;
		ownerId?: number | null;
	}
): ProjectDTO {
	const existing = db.select().from(projects).where(eq(projects.id, id)).get();
	if (!existing || !canSeeProject(user, existing)) throw new ServiceError(404, 'project not found');
	if (patch.name !== undefined && !patch.name.trim())
		throw new ServiceError(400, 'name is required');
	if ('locationId' in patch) assertLocationId(db, patch.locationId);
	if ('wikiRef' in patch) assertWikiRef(patch.wikiRef);
	if ('ownerId' in patch && patch.ownerId !== existing.ownerId) {
		const newOwnerId = patch.ownerId ?? null;
		if (newOwnerId === null) {
			if (existing.ownerId !== null && user.id !== existing.ownerId)
				throw new ServiceError(403, 'only the owner can make a private project public');
		} else {
			if (existing.ownerId !== null) throw new ServiceError(400, 'owner cannot be transferred');
			assertOwnerId(db, user, newOwnerId);
			assertNoForeignAssignees(db, id, newOwnerId);
		}
	}
	const next: Record<string, unknown> = {};
	if (patch.name !== undefined) next.name = patch.name.trim();
	if (patch.color !== undefined) next.color = patch.color;
	if (patch.archived !== undefined) next.archived = patch.archived;
	if ('locationId' in patch) next.locationId = patch.locationId ?? null;
	if ('wikiRef' in patch) next.wikiRef = patch.wikiRef ?? null;
	if ('ownerId' in patch) next.ownerId = patch.ownerId ?? null;
	if (Object.keys(next).length === 0) return existing;
	return db.update(projects).set(next).where(eq(projects.id, id)).returning().get();
}

export function listUsers(db: Db): SafeUser[] {
	return db.select().from(users).orderBy(asc(users.name)).all().map(toSafeUser);
}
