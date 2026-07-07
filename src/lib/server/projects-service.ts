import { eq, asc } from 'drizzle-orm';
import type { Db } from './db';
import { projects, users } from './db/schema';
import { ServiceError } from './errors';
import { toSafeUser, type SafeUser } from './auth';
import type { ProjectDTO } from '$lib/types';

export function listProjects(db: Db): ProjectDTO[] {
	return db.select().from(projects).orderBy(asc(projects.name)).all();
}

export function createProject(db: Db, input: { name: string; color?: string }): ProjectDTO {
	if (!input.name?.trim()) throw new ServiceError(400, 'name is required');
	return db
		.insert(projects)
		.values({ name: input.name.trim(), color: input.color ?? '#6b7280' })
		.returning()
		.get();
}

export function updateProject(
	db: Db,
	id: number,
	patch: { name?: string; color?: string; archived?: boolean }
): ProjectDTO {
	const existing = db.select().from(projects).where(eq(projects.id, id)).get();
	if (!existing) throw new ServiceError(404, 'project not found');
	if (patch.name !== undefined && !patch.name.trim())
		throw new ServiceError(400, 'name is required');
	const next: Record<string, unknown> = {};
	if (patch.name !== undefined) next.name = patch.name.trim();
	if (patch.color !== undefined) next.color = patch.color;
	if (patch.archived !== undefined) next.archived = patch.archived;
	if (Object.keys(next).length === 0) return existing;
	return db.update(projects).set(next).where(eq(projects.id, id)).returning().get();
}

export function listUsers(db: Db): SafeUser[] {
	return db.select().from(users).orderBy(asc(users.name)).all().map(toSafeUser);
}
