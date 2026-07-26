import { eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, projects, documents } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';

export function canSeeProject(user: SafeUser, project: { ownerId: number | null }): boolean {
	return user.type === 'ai' || project.ownerId === null || project.ownerId === user.id;
}

// WHERE fragment for queries on the tasks table. undefined = no filtering (AI).
export function taskVisibilityCond(user: SafeUser): SQL | undefined {
	if (user.type === 'ai') return undefined;
	return sql`(${tasks.projectId} IS NULL OR ${tasks.projectId} NOT IN (SELECT ${projects.id} FROM ${projects} WHERE ${projects.ownerId} IS NOT NULL AND ${projects.ownerId} != ${user.id}))`;
}

export function projectVisibilityCond(user: SafeUser): SQL | undefined {
	if (user.type === 'ai') return undefined;
	return sql`(${projects.ownerId} IS NULL OR ${projects.ownerId} = ${user.id})`;
}

export function documentVisibilityCond(user: SafeUser): SQL | undefined {
	if (user.type === 'ai') return undefined;
	return sql`(${documents.projectId} IS NULL OR ${documents.projectId} NOT IN (SELECT ${projects.id} FROM ${projects} WHERE ${projects.ownerId} IS NOT NULL AND ${projects.ownerId} != ${user.id}))`;
}

// 404 (not 403): foreign private resources must not reveal their existence.
export function assertTaskVisible(
	db: Db,
	user: SafeUser,
	task: { projectId: number | null }
): void {
	if (user.type === 'ai' || task.projectId === null) return;
	const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
	if (project && !canSeeProject(user, project)) throw new ServiceError(404, 'task not found');
}

// For writes that reference a projectId: missing and foreign-private look identical (400).
export function assertProjectUsable(
	db: Db,
	user: SafeUser,
	projectId: number | null | undefined
): typeof projects.$inferSelect | null {
	if (projectId === null || projectId === undefined) return null;
	const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
	if (!project || !canSeeProject(user, project))
		throw new ServiceError(400, 'invalid projectId: project not found');
	return project;
}
