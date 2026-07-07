<script lang="ts">
	import { onMount } from 'svelte';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import Board from '$lib/components/Board.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import { board } from '$lib/client/board.svelte';

	let { data, children } = $props();

	// re-init whenever the server load reruns (login change, hard reload)
	$effect.pre(() => {
		board.init(data);
	});

	onMount(() => board.connectSse());
</script>

<FilterBar />
<Board />
{@render children()}
<Toasts />
