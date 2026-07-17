import { and, eq, or, like, asc, desc, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { documents, documentTasks, tasks } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import type { DocumentDTO, TaskRefDTO, DocRefDTO } from '$lib/types';

export type DocFilters = {
	project?: number;
	q?: string;
	limit?: number;
	offset?: number;
};

export type DocumentInput = {
	title: string;
	body?: string;
	projectId?: number | null;
};

function assertProjectId(value: unknown): void {
	if (value !== null && value !== undefined && typeof value !== 'number')
		throw new ServiceError(400, 'invalid projectId: must be a number');
}

function assertBody(value: unknown): void {
	if (value !== null && value !== undefined && typeof value !== 'string')
		throw new ServiceError(400, 'invalid body: must be a string');
}

export function parseDocFilters(params: URLSearchParams): DocFilters {
	const f: DocFilters = {};
	const project = params.get('project');
	if (project) f.project = Number(project);
	const q = params.get('q');
	if (q) f.q = q;
	const limit = params.get('limit');
	if (limit) f.limit = Number(limit);
	const offset = params.get('offset');
	if (offset) f.offset = Number(offset);
	return f;
}

export function listDocuments(db: Db, filters: DocFilters = {}): DocumentDTO[] {
	const conds: SQL[] = [];
	if (filters.project !== undefined) conds.push(eq(documents.projectId, filters.project));
	if (filters.q) {
		const pattern = `%${filters.q}%`;
		conds.push(or(like(documents.title, pattern), like(documents.body, pattern))!);
	}
	return db
		.select()
		.from(documents)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(desc(documents.updatedAt), desc(documents.id))
		.limit(filters.limit ?? -1)
		.offset(filters.offset ?? 0)
		.all();
}

export function createDocument(db: Db, user: SafeUser, input: DocumentInput): DocumentDTO {
	if (typeof input.title !== 'string' || !input.title.trim())
		throw new ServiceError(400, 'title is required');
	assertBody(input.body);
	assertProjectId(input.projectId);
	const now = new Date().toISOString();
	return db
		.insert(documents)
		.values({
			title: input.title.trim(),
			body: input.body ?? '',
			projectId: input.projectId ?? null,
			createdBy: user.id,
			createdAt: now,
			updatedAt: now
		})
		.returning()
		.get();
}

function taskRefs(db: Db, documentId: number): TaskRefDTO[] {
	return db
		.select({ id: tasks.id, title: tasks.title, status: tasks.status })
		.from(documentTasks)
		.innerJoin(tasks, eq(tasks.id, documentTasks.taskId))
		.where(eq(documentTasks.documentId, documentId))
		.orderBy(asc(tasks.id))
		.all();
}

export function getDocument(db: Db, id: number): DocumentDTO & { tasks: TaskRefDTO[] } {
	const doc = db.select().from(documents).where(eq(documents.id, id)).get();
	if (!doc) throw new ServiceError(404, 'document not found');
	return { ...doc, tasks: taskRefs(db, id) };
}

const UPDATABLE = ['title', 'body', 'projectId'] as const;

export function updateDocument(
	db: Db,
	user: SafeUser,
	id: number,
	patch: Partial<DocumentInput>
): DocumentDTO {
	const existing = db.select().from(documents).where(eq(documents.id, id)).get();
	if (!existing) throw new ServiceError(404, 'document not found');
	if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim()))
		throw new ServiceError(400, 'title is required');
	assertBody(patch.body);
	if ('projectId' in patch) assertProjectId(patch.projectId);

	const next: Record<string, unknown> = { updatedAt: new Date().toISOString() };
	for (const key of UPDATABLE) {
		if (key in patch) next[key] = key === 'title' ? patch.title!.trim() : patch[key] ?? (key === 'body' ? '' : null);
	}
	return db.update(documents).set(next).where(eq(documents.id, id)).returning().get();
}

export function deleteDocument(db: Db, user: SafeUser, id: number): DocumentDTO {
	if (user.type === 'ai') throw new ServiceError(403, 'AI users cannot delete documents');
	const existing = db.select().from(documents).where(eq(documents.id, id)).get();
	if (!existing) throw new ServiceError(404, 'document not found');
	db.transaction((tx) => {
		tx.delete(documentTasks).where(eq(documentTasks.documentId, id)).run();
		tx.delete(documents).where(eq(documents.id, id)).run();
	});
	return existing;
}

function assertDocExists(db: Db, documentId: number): void {
	if (!db.select().from(documents).where(eq(documents.id, documentId)).get())
		throw new ServiceError(404, 'document not found');
}

function assertTaskExists(db: Db, taskId: number): void {
	if (!db.select().from(tasks).where(eq(tasks.id, taskId)).get())
		throw new ServiceError(404, 'task not found');
}

export function linkTask(db: Db, user: SafeUser, documentId: number, taskId: number): void {
	assertDocExists(db, documentId);
	assertTaskExists(db, taskId);
	db.insert(documentTasks).values({ documentId, taskId }).onConflictDoNothing().run();
}

export function unlinkTask(db: Db, user: SafeUser, documentId: number, taskId: number): void {
	assertDocExists(db, documentId);
	db.delete(documentTasks)
		.where(and(eq(documentTasks.documentId, documentId), eq(documentTasks.taskId, taskId)))
		.run();
}

export function listDocRefsForTask(db: Db, taskId: number): DocRefDTO[] {
	return db
		.select({ id: documents.id, title: documents.title })
		.from(documentTasks)
		.innerJoin(documents, eq(documents.id, documentTasks.documentId))
		.where(eq(documentTasks.taskId, taskId))
		.orderBy(asc(documents.title))
		.all();
}
