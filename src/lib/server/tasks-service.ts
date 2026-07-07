import { and, eq, ne, or, like, sql, asc, desc, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, users, comments, projects } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import { STATUSES, PRIORITIES, SIZES, type Status, type Priority, type Size, type TaskDTO, type CommentDTO } from '$lib/types';

export type TaskFilters = {
	assignee?: string;
	project?: number;
	location?: number;
	status?: Status;
	open?: boolean;
	q?: string;
	limit?: number;
	offset?: number;
};

export type TaskInput = {
	title: string;
	description?: string;
	status?: Status;
	priority?: Priority | null;
	size?: Size | null;
	hours?: number | null;
	dueDate?: string | null;
	assigneeId?: number | null;
	projectId?: number | null;
};

export function assertEnum<T extends string>(
	field: string,
	value: unknown,
	allowed: readonly T[]
): void {
	if (value !== null && value !== undefined && !allowed.includes(value as T))
		throw new ServiceError(400, `invalid ${field}: must be one of ${allowed.join(', ')}`);
}

function assertType(field: string, value: unknown, type: 'string' | 'number'): void {
	if (value !== null && value !== undefined && typeof value !== type)
		throw new ServiceError(400, `invalid ${field}: must be a ${type}`);
}

function validateEnums(input: Partial<TaskInput>): void {
	assertEnum('status', input.status, STATUSES);
	assertEnum('priority', input.priority, PRIORITIES);
	assertEnum('size', input.size, SIZES);
}

function validateTypes(input: Partial<TaskInput>): void {
	assertType('title', input.title, 'string');
	assertType('description', input.description, 'string');
	assertType('dueDate', input.dueDate, 'string');
	assertType('hours', input.hours, 'number');
	assertType('assigneeId', input.assigneeId, 'number');
	assertType('projectId', input.projectId, 'number');
}

const boardOrder = [
	sql`CASE ${tasks.priority} WHEN 'Super-High' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END`,
	sql`${tasks.dueDate} IS NULL`,
	tasks.dueDate,
	tasks.createdAt
];

const doneOrder = [sql`${tasks.completedAt} IS NULL`, desc(tasks.completedAt), desc(tasks.createdAt)];

export function listTasks(db: Db, filters: TaskFilters = {}): TaskDTO[] {
	const conds: SQL[] = [];
	if (filters.assignee !== undefined) {
		if (/^\d+$/.test(filters.assignee)) {
			conds.push(eq(tasks.assigneeId, Number(filters.assignee)));
		} else {
			const user = db
				.select()
				.from(users)
				.where(sql`lower(${users.name}) = lower(${filters.assignee})`)
				.get();
			if (!user) return [];
			conds.push(eq(tasks.assigneeId, user.id));
		}
	}
	if (filters.project !== undefined) conds.push(eq(tasks.projectId, filters.project));
	if (filters.location !== undefined)
		conds.push(
			sql`${tasks.projectId} IN (SELECT ${projects.id} FROM ${projects} WHERE ${projects.locationId} = ${filters.location})`
		);
	if (filters.status) conds.push(eq(tasks.status, filters.status));
	if (filters.open) conds.push(ne(tasks.status, 'Done'));
	if (filters.q) {
		const pattern = `%${filters.q}%`;
		conds.push(or(like(tasks.title, pattern), like(tasks.description, pattern))!);
	}
	return db
		.select()
		.from(tasks)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(...(filters.status === 'Done' ? doneOrder : boardOrder))
		.limit(filters.limit ?? -1)
		.offset(filters.offset ?? 0)
		.all();
}

export function createTask(db: Db, user: SafeUser, input: TaskInput): TaskDTO {
	validateTypes(input);
	if (!input.title?.trim()) throw new ServiceError(400, 'title is required');
	validateEnums(input);
	if (input.status === 'Done' && user.type === 'ai')
		throw new ServiceError(403, 'AI users cannot set status to Done');
	const now = new Date().toISOString();
	return db
		.insert(tasks)
		.values({
			title: input.title.trim(),
			description: input.description ?? '',
			status: input.status ?? 'Inbox',
			priority: input.priority ?? null,
			size: input.size ?? null,
			hours: input.hours ?? null,
			dueDate: input.dueDate ?? null,
			assigneeId: input.assigneeId ?? null,
			projectId: input.projectId ?? null,
			createdBy: user.id,
			createdAt: now,
			updatedAt: now,
			completedAt: input.status === 'Done' ? now : null
		})
		.returning()
		.get();
}

export function parseTaskFilters(params: URLSearchParams): TaskFilters {
	const f: TaskFilters = {};
	const assignee = params.get('assignee');
	if (assignee) f.assignee = assignee;
	const project = params.get('project');
	if (project) f.project = Number(project);
	const location = params.get('location');
	if (location) f.location = Number(location);
	const status = params.get('status');
	if (status) f.status = status as Status;
	if (params.get('open') === 'true') f.open = true;
	const q = params.get('q');
	if (q) f.q = q;
	const limit = params.get('limit');
	if (limit) f.limit = Number(limit);
	const offset = params.get('offset');
	if (offset) f.offset = Number(offset);
	return f;
}

export function getTask(db: Db, id: number): TaskDTO & { comments: CommentDTO[] } {
	const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
	if (!task) throw new ServiceError(404, 'task not found');
	const taskComments = db
		.select()
		.from(comments)
		.where(eq(comments.taskId, id))
		.orderBy(asc(comments.createdAt))
		.all();
	return { ...task, comments: taskComments };
}

const UPDATABLE = [
	'title', 'description', 'status', 'priority', 'size', 'hours',
	'dueDate', 'assigneeId', 'projectId'
] as const;

export function updateTask(
	db: Db,
	user: SafeUser,
	id: number,
	patch: Partial<TaskInput>
): TaskDTO {
	const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
	if (!existing) throw new ServiceError(404, 'task not found');
	validateTypes(patch);
	validateEnums(patch);
	if (patch.status === 'Done' && user.type === 'ai')
		throw new ServiceError(403, 'AI users cannot set status to Done');
	if (patch.title !== undefined && !patch.title.trim())
		throw new ServiceError(400, 'title is required');

	const next: Record<string, unknown> = { updatedAt: new Date().toISOString() };
	for (const key of UPDATABLE) {
		if (key in patch) next[key] = patch[key];
	}
	if (patch.status && patch.status !== existing.status) {
		next.completedAt = patch.status === 'Done' ? new Date().toISOString() : null;
	}
	return db.update(tasks).set(next).where(eq(tasks.id, id)).returning().get();
}
