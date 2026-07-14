import { describe, it, expect } from 'vitest';
import { compareTasks, compareDone, board } from './board.svelte';
import type { TaskDTO, LocationDTO, ProjectDTO } from '$lib/types';

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

describe('compareDone', () => {
	it('orders by most recently completed, falling back to createdAt', () => {
		const older = task({
			title: 'older',
			status: 'Done',
			completedAt: '2026-01-01T00:00:00.000Z',
			priority: 'Super-High'
		});
		const newer = task({
			title: 'newer',
			status: 'Done',
			completedAt: '2026-02-01T00:00:00.000Z',
			priority: 'Low'
		});
		const noCompletedAt = task({
			title: 'no-completed-at',
			status: 'Done',
			completedAt: null,
			createdAt: '2026-03-01T00:00:00.000Z'
		});
		expect([older, newer].sort(compareDone)).toEqual([newer, older]);
		expect([newer, noCompletedAt].sort(compareDone)).toEqual([noCompletedAt, newer]);
	});
});

describe('location filter', () => {
	it('filters by the project location', () => {
		board.init({
			user: { id: 1, name: 'M', email: null, type: 'human', color: '#fff' },
			tasks: [
				task({ id: 1, projectId: 10 }),
				task({ id: 2, projectId: 20 }),
				task({ id: 3, projectId: null })
			],
			done: [],
			users: [],
			projects: [
				{ id: 10, name: 'Teichbau', color: '#fff', archived: false, locationId: 5, wikiRef: null },
				{ id: 20, name: 'Elsewhere', color: '#fff', archived: false, locationId: null, wikiRef: null }
			],
			locations: [{ id: 5, name: 'Schiffmühle', archived: false }]
		});
		expect(board.filtered(new URLSearchParams('location=5')).map((t) => t.id)).toEqual([1]);
	});
});

describe('ticket-id search', () => {
	function initWith(ts: TaskDTO[]) {
		board.init({
			user: { id: 1, name: 'M', email: null, type: 'human', color: '#fff' },
			tasks: ts,
			done: [],
			users: [],
			projects: [],
			locations: []
		});
	}

	it('a plain number matches the task with exactly that id, alongside text matches', () => {
		initWith([
			task({ id: 186, title: 'Zaun bauen' }),
			task({ id: 187, title: 'Rechnung 186 prüfen' }),
			task({ id: 3, title: 'Anderes' })
		]);
		expect(
			board
				.filtered(new URLSearchParams('q=186'))
				.map((t) => t.id)
				.sort()
		).toEqual([186, 187]);
	});

	it('#<zahl> matches ids by prefix (incremental typing)', () => {
		initWith([
			task({ id: 18, title: 'A' }),
			task({ id: 186, title: 'B' }),
			task({ id: 3, title: 'C' })
		]);
		expect(
			board
				.filtered(new URLSearchParams('q=#18'))
				.map((t) => t.id)
				.sort()
		).toEqual([18, 186]);
		expect(board.filtered(new URLSearchParams('q=#186')).map((t) => t.id)).toEqual([186]);
	});

	it('a plain number does not prefix-match ids', () => {
		initWith([task({ id: 18, title: 'A' }), task({ id: 186, title: 'B' })]);
		expect(board.filtered(new URLSearchParams('q=18')).map((t) => t.id)).toEqual([18]);
	});
});

describe('filterDefaults', () => {
	it('maps active assignee/project filters to new-task fields', () => {
		expect(board.filterDefaults(new URLSearchParams('assignee=2&project=7&q=x&location=5'))).toEqual({
			assigneeId: 2,
			projectId: 7
		});
		expect(board.filterDefaults(new URLSearchParams('q=wood'))).toEqual({});
		expect(board.filterDefaults(new URLSearchParams(''))).toEqual({});
	});
});
