<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import QuickAdd from './QuickAdd.svelte';
	import { board } from '$lib/client/board.svelte';
	import type { Status, TaskDTO } from '$lib/types';

	let { status, tasks }: { status: Status; tasks: TaskDTO[] } = $props();

	// The Done lane also hosts Dropped tasks behind a toggle (#801).
	const countStatus = $derived<Status>(status === 'Done' ? board.closedView : status);

	function ondrop(e: DragEvent) {
		e.preventDefault();
		const id = Number(e.dataTransfer?.getData('text/task-id'));
		if (id) board.patchTask(id, { status });
	}
</script>

<section
	class="column"
	class:in-progress={status === 'In Progress'}
	data-column={status}
	role="list"
	ondragover={(e) => e.preventDefault()}
	{ondrop}
>
	<header>{status} <span class="count">{board.countLabel(countStatus, tasks.length)}</span></header>
	{#if status === 'Done'}
		<div class="closed-toggle" role="group" aria-label="Erledigt oder verworfen">
			<button
				class:active={board.closedView === 'Done'}
				aria-pressed={board.closedView === 'Done'}
				onclick={() => (board.closedView = 'Done')}>Erledigt</button
			>
			<button
				class:active={board.closedView === 'Dropped'}
				aria-pressed={board.closedView === 'Dropped'}
				onclick={() => (board.closedView = 'Dropped')}>Verworfen</button
			>
		</div>
	{/if}
	{#if !(status === 'Done' && board.closedView === 'Dropped')}
		<QuickAdd {status} />
	{/if}
	<div class="cards">
		{#each tasks as task (task.id)}
			<TaskCard {task} />
		{/each}
		{#if status === 'Done'}
			<button class="more" onclick={() => board.loadMoreClosed(board.closedView)}>Load more</button>
		{/if}
	</div>
</section>

<style>
	.column {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 240px;
		width: 240px;
		flex-shrink: 0;
	}
	.column.in-progress {
		min-width: 280px;
		width: 280px;
		background: #e8f6ed;
		border: 1px solid #bfe6cc;
		border-radius: var(--radius);
		padding: 10px;
	}
	header {
		font-weight: 600;
		font-size: 13px;
		padding: 0 2px;
	}
	.count {
		color: var(--muted);
		font-weight: 400;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow-y: auto;
	}
	.closed-toggle {
		display: flex;
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}
	.closed-toggle button {
		flex: 1;
		padding: 4px 6px;
		border: 0;
		background: var(--surface);
		color: var(--muted);
		font-size: 12px;
		cursor: pointer;
	}
	.closed-toggle button + button {
		border-left: 1px solid var(--border);
	}
	.closed-toggle button.active {
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
		color: inherit;
		font-weight: 600;
	}
	.more {
		padding: 6px;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	@media (max-width: 767px) {
		.column,
		.column.in-progress {
			width: 100%;
			min-width: 0;
		}
		/* #257: Spalten-Header mobil einen Punkt größer (Micha, 30.07.2026) */
		header {
			font-size: 14px;
		}
	}
</style>
