<script lang="ts">
	import { page } from '$app/state';
	import { MediaQuery } from 'svelte/reactivity';
	import Column from './Column.svelte';
	import { board, compareDone } from '$lib/client/board.svelte';
	import { STATUSES, type Status } from '$lib/types';

	const filtered = $derived(board.filtered(page.url.searchParams));
	const isMobile = new MediaQuery('(max-width: 767px)');
	let mobileStatus = $state<Status>('Inbox');

	function columnTasks(status: Status) {
		const inColumn = filtered.filter((t) => t.status === status);
		return status === 'Done' ? inColumn.sort(compareDone) : inColumn;
	}
</script>

{#if isMobile.current}
	<div class="board mobile">
		<nav class="status-tabs">
			{#each STATUSES as status (status)}
				<button
					class="tab"
					class:active={mobileStatus === status}
					onclick={() => (mobileStatus = status)}
				>
					{status} <span class="count">{columnTasks(status).length}</span>
				</button>
			{/each}
		</nav>
		<Column status={mobileStatus} tasks={columnTasks(mobileStatus)} />
	</div>
{:else}
	<div class="board">
		{#each STATUSES as status (status)}
			<Column {status} tasks={columnTasks(status)} />
		{/each}
	</div>
{/if}

<style>
	.board {
		display: flex;
		gap: 14px;
		padding: 14px;
		overflow-x: auto;
		height: calc(100vh - 54px);
		align-items: flex-start;
	}
	.board.mobile {
		flex-direction: column;
		align-items: stretch;
		overflow-x: hidden;
		overflow-y: auto;
		gap: 10px;
	}
	.status-tabs {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		flex-shrink: 0;
		padding-bottom: 2px;
	}
	.tab {
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		white-space: nowrap;
		cursor: pointer;
		min-height: 44px;
	}
	.tab.active {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
		font-weight: 600;
	}
	.tab .count {
		color: var(--muted);
	}
</style>
