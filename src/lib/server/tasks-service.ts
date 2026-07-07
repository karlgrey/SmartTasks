import { and, eq, ne, or, like, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, users } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import { STATUSES, PRIORITIES, SIZES, type Status, type Priority, type Size, type TaskDTO } from '$lib/types';

export type TaskFilters = {
	assignee?: string;
	project?: number;
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

function validateEnums(input: Partial<TaskInput>): void {
	assertEnum('status', input.status, STATUSES);
	assertEnum('priority', input.priority, PRIORITIES);
	assertEnum('size', input.size, SIZES);
}

const boardOrder = [
	sql`CASE ${tasks.priority} WHEN 'Super-High' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END`,
	sql`${tasks.dueDate} IS NULL`,
	tasks.dueDate,
	tasks.createdAt
];

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
		.orderBy(...boardOrder)
		.limit(filters.limit ?? -1)
		.offset(filters.offset ?? 0)
		.all();
}

export function createTask(db: Db, user: SafeUser, input: TaskInput): TaskDTO {
	if (!input.title?.trim()) throw new ServiceError(400, 'title is required');
	validateEnums(input);
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
			updatedAt: now
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
