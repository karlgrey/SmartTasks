import { describe, it, expect } from 'vitest';
import { compareTasks } from './board.svelte';
import type { TaskDTO } from '$lib/types';

function task(over: Partial<TaskDTO>): TaskDTO {
	return {
		id: Math.floor(Math.random() * 1e6),
		title: 't',
		description: '',
		status: 'To Do',
		priority: null,
		size: null,
		hours: null,
		dueDate: null,
		assigneeId: null,
		projectId: null,
		createdBy: 1,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		completedAt: null,
		...over
	};
}

describe('compareTasks', () => {
	it('orders by priority, then due date (none last), then age', () => {
		const urgent = task({ priority: 'Super-High' });
		const low = task({ priority: 'Low' });
		const dueSoon = task({ dueDate: '2026-01-05' });
		const dueLater = task({ dueDate: '2026-06-01' });
		const noDue = task({ createdAt: '2025-01-01T00:00:00.000Z' });
		const sorted = [noDue, dueLater, low, dueSoon, urgent].sort(compareTasks);
		expect(sorted).toEqual([urgent, low, dueSoon, dueLater, noDue]);
	});
});
