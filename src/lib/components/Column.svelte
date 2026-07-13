<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import QuickAdd from './QuickAdd.svelte';
	import { board } from '$lib/client/board.svelte';
	import type { Status, TaskDTO } from '$lib/types';

	let { status, tasks }: { status: Status; tasks: TaskDTO[] } = $props();

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
	<header>{status} <span class="count">{tasks.length}</span></header>
	<QuickAdd {status} />
	<div class="cards">
		{#each tasks as task (task.id)}
			<TaskCard {task} />
		{/each}
		{#if status === 'Done'}
			<button class="more" onclick={() => board.loadMoreDone()}>Load more</button>
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
	}
</style>
