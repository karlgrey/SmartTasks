import type { TaskDTO, CommentDTO } from '$lib/types';

export type TaskEvent = {
	type: 'task.created' | 'task.updated' | 'comment.created' | 'task.deleted';
	task: TaskDTO;
	comment?: CommentDTO;
};

const listeners = new Set<(e: TaskEvent) => void>();

export function subscribe(fn: (e: TaskEvent) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function emit(e: TaskEvent): void {
	for (const listener of listeners) {
		try {
			listener(e);
		} catch {
			// one broken client must not affect the others
		}
	}
}
