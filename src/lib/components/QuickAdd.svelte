<script lang="ts">
	import { page } from '$app/state';
	import { board } from '$lib/client/board.svelte';
	import type { Status } from '$lib/types';

	let { status }: { status: Status } = $props();
	let title = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim()) return;
		await board.createTask({
			title: title.trim(),
			status,
			...board.filterDefaults(page.url.searchParams)
		});
		title = '';
	}
</script>

<form onsubmit={submit}>
	<input placeholder="Add task…" bind:value={title} />
</form>

<style>
	input {
		width: 100%;
		padding: 6px 10px;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: none;
	}
	input:focus {
		background: var(--surface);
		border-style: solid;
		outline: none;
	}
</style>
