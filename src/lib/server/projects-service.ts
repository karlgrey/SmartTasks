import { eq, asc } from 'drizzle-orm';
import type { Db } from './db';
import { projects, users, locations } from './db/schema';
import { ServiceError } from './errors';
import { toSafeUser, type SafeUser } from './auth';
import type { ProjectDTO } from '$lib/types';

export function listProjects(db: Db): ProjectDTO[] {
	return db.select().from(projects).orderBy(asc(projects.name)).all();
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
	input: { name: string; color?: string; locationId?: number | null; wikiRef?: string | null }
): ProjectDTO {
	if (!input.name?.trim()) throw new ServiceError(400, 'name is required');
	assertLocationId(db, input.locationId);
	assertWikiRef(input.wikiRef);
	return db
		.insert(projects)
		.values({
			name: input.name.trim(),
			color: input.color ?? '#6b7280',
			locationId: input.locationId ?? null,
			wikiRef: input.wikiRef ?? null
		})
		.returning()
		.get();
}

export function updateProject(
	db: Db,
	id: number,
	patch: {
		name?: string;
		color?: string;
		archived?: boolean;
		locationId?: number | null;
		wikiRef?: string | null;
	}
): ProjectDTO {
	const existing = db.select().from(projects).where(eq(projects.id, id)).get();
	if (!existing) throw new ServiceError(404, 'project not found');
	if (patch.name !== undefined && !patch.name.trim())
		throw new ServiceError(400, 'name is required');
	if ('locationId' in patch) assertLocationId(db, patch.locationId);
	if ('wikiRef' in patch) assertWikiRef(patch.wikiRef);
	const next: Record<string, unknown> = {};
	if (patch.name !== undefined) next.name = patch.name.trim();
	if (patch.color !== undefined) next.color = patch.color;
	if (patch.archived !== undefined) next.archived = patch.archived;
	if ('locationId' in patch) next.locationId = patch.locationId ?? null;
	if ('wikiRef' in patch) next.wikiRef = patch.wikiRef ?? null;
	if (Object.keys(next).length === 0) return existing;
	return db.update(projects).set(next).where(eq(projects.id, id)).returning().get();
}

export function listUsers(db: Db): SafeUser[] {
	return db.select().from(users).orderBy(asc(users.name)).all().map(toSafeUser);
}
