<script lang="ts">
	import { board } from '$lib/client/board.svelte';
</script>

<div class="toasts">
	{#each board.toasts as t (t.id)}
		<div class="toast">{t.message}</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		bottom: 16px;
		right: 16px;
		display: grid;
		gap: 8px;
		z-index: 100;
	}
	.toast {
		padding: 10px 14px;
		background: #1f2328;
		color: #fff;
		border-radius: var(--radius);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
		max-width: 320px;
	}
</style>
