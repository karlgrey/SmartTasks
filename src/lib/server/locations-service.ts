import { eq, asc, sql, ne, and } from 'drizzle-orm';
import type { Db } from './db';
import { locations } from './db/schema';
import { ServiceError } from './errors';
import type { LocationDTO } from '$lib/types';

function assertNameFree(db: Db, name: string, excludeId?: number): void {
	const clash = db
		.select()
		.from(locations)
		.where(
			excludeId === undefined
				? sql`lower(${locations.name}) = lower(${name})`
				: and(sql`lower(${locations.name}) = lower(${name})`, ne(locations.id, excludeId))
		)
		.get();
	if (clash) throw new ServiceError(400, 'location name already exists');
}

export function listLocations(db: Db): LocationDTO[] {
	return db.select().from(locations).orderBy(asc(locations.name)).all();
}

export function createLocation(db: Db, input: { name: string }): LocationDTO {
	if (typeof input.name !== 'string' || !input.name.trim())
		throw new ServiceError(400, 'name is required');
	const trimmedName = input.name.trim();
	assertNameFree(db, trimmedName);
	return db.insert(locations).values({ name: trimmedName }).returning().get();
}

export function updateLocation(
	db: Db,
	id: number,
	patch: { name?: string; archived?: boolean }
): LocationDTO {
	const existing = db.select().from(locations).where(eq(locations.id, id)).get();
	if (!existing) throw new ServiceError(404, 'location not found');
	if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim()))
		throw new ServiceError(400, 'name is required');
	const next: Record<string, unknown> = {};
	if (patch.name !== undefined) {
		const trimmedName = patch.name.trim();
		assertNameFree(db, trimmedName, id);
		next.name = trimmedName;
	}
	if (patch.archived !== undefined) next.archived = patch.archived;
	if (Object.keys(next).length === 0) return existing;
	return db.update(locations).set(next).where(eq(locations.id, id)).returning().get();
}
