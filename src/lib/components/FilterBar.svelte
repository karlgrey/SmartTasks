<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { board } from '$lib/client/board.svelte';

	const current = $derived(new URLSearchParams(page.url.search));

	function setParam(key: string, value: string | null) {
		const params = new URLSearchParams(page.url.search);
		if (value) params.set(key, value);
		else params.delete(key);
		const qs = params.toString();
		goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function toggleAssignee(id: number) {
		const val = String(id);
		setParam('assignee', current.get('assignee') === val ? null : val);
	}
</script>

<nav>
	<strong>SmartTasks</strong>
	<a class="docs-link" href="/docs">Docs</a>
	{#each board.users as u (u.id)}
		<button
			class="chip"
			class:active={current.get('assignee') === String(u.id)}
			style="--c:{u.color}"
			onclick={() => toggleAssignee(u.id)}
		>
			{u.name}{#if u.type === 'ai'}<span class="ai">AI</span>{/if}
		</button>
	{/each}
	<select onchange={(e) => setParam('project', e.currentTarget.value || null)}>
		<option value="">All projects</option>
		{#each board.projects.filter((p) => !p.archived) as p (p.id)}
			<option value={p.id} selected={current.get('project') === String(p.id)}>{p.name}</option>
		{/each}
	</select>
	<select onchange={(e) => setParam('location', e.currentTarget.value || null)}>
		<option value="">All locations</option>
		{#each board.locations.filter((l) => !l.archived) as l (l.id)}
			<option value={l.id} selected={current.get('location') === String(l.id)}>{l.name}</option>
		{/each}
	</select>
	<input
		type="search"
		placeholder="Search…"
		value={current.get('q') ?? ''}
		oninput={(e) => setParam('q', e.currentTarget.value || null)}
	/>
	<span class="spacer"></span>
	<span class="me">{board.me?.name}</span>
	<button
		class="logout"
		onclick={async () => {
			await fetch('/api/auth/logout', { method: 'POST' });
			location.href = '/login';
		}}>Logout</button
	>
</nav>

<style>
	nav {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.chip {
		padding: 3px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: none;
		cursor: pointer;
	}
	.chip.active {
		border-color: var(--c);
		background: color-mix(in srgb, var(--c) 15%, transparent);
		font-weight: 600;
	}
	.ai {
		margin-left: 4px;
		font-size: 10px;
		color: var(--muted);
	}
	.docs-link {
		color: var(--accent);
		text-decoration: none;
		font-weight: 600;
	}
	select,
	input {
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.spacer {
		flex: 1;
	}
	.me {
		color: var(--muted);
	}
	.logout {
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	@media (max-width: 767px) {
		nav {
			flex-wrap: nowrap;
			overflow-x: auto;
		}
	}
</style>
