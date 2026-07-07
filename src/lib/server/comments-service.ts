import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, comments } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import type { CommentDTO, TaskDTO } from '$lib/types';

export function addComment(
	db: Db,
	user: SafeUser,
	taskId: number,
	body: string
): { comment: CommentDTO; task: TaskDTO } {
	if (!body?.trim()) throw new ServiceError(400, 'body is required');
	const existing = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
	if (!existing) throw new ServiceError(404, 'task not found');
	const now = new Date().toISOString();
	const comment = db
		.insert(comments)
		.values({ taskId, authorId: user.id, body: body.trim(), createdAt: now })
		.returning()
		.get();
	const task = db
		.update(tasks)
		.set({ updatedAt: now })
		.where(eq(tasks.id, taskId))
		.returning()
		.get();
	return { comment, task };
}
