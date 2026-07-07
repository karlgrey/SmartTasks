<script lang="ts">
	import { page } from '$app/state';
	import Column from './Column.svelte';
	import { board } from '$lib/client/board.svelte';
	import { STATUSES } from '$lib/types';

	const filtered = $derived(board.filtered(page.url.searchParams));
</script>

<div class="board">
	{#each STATUSES as status (status)}
		<Column {status} tasks={filtered.filter((t) => t.status === status)} />
	{/each}
</div>

<style>
	.board {
		display: flex;
		gap: 14px;
		padding: 14px;
		overflow-x: auto;
		height: calc(100vh - 54px);
		align-items: flex-start;
	}
</style>
