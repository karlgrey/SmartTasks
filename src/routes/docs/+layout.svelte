<script lang="ts">
	let { children } = $props();
</script>

<nav>
	<strong>SmartTasks</strong>
	<a href="/">← Board</a>
	<a href="/docs">Docs</a>
	<span class="spacer"></span>
</nav>

<main>
	{@render children()}
</main>

<style>
	nav {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 14px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	nav a {
		color: var(--accent);
		text-decoration: none;
	}
	.spacer {
		flex: 1;
	}
	main {
		max-width: 820px;
		margin: 0 auto;
		padding: 18px 14px 60px;
	}
</style>
