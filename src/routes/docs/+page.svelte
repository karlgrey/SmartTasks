<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let { data } = $props();

	const projectName = (id: number | null) =>
		data.projects.find((p) => p.id === id)?.name ?? null;
	const fmtDate = (iso: string) => iso.slice(0, 10);

	function setParam(key: string, value: string | null) {
		const params = new URLSearchParams(page.url.search);
		if (value) params.set(key, value);
		else params.delete(key);
		const qs = params.toString();
		goto(`/docs${qs ? `?${qs}` : ''}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<header class="top">
	<h1>Docs</h1>
	<a class="new" href="/docs/new">+ New document</a>
</header>

<div class="filters">
	<select
		aria-label="Filter by project"
		onchange={(e) => setParam('project', e.currentTarget.value || null)}
	>
		<option value="">All projects</option>
		{#each data.projects.filter((p) => !p.archived) as p (p.id)}
			<option value={p.id} selected={data.project === p.id}>{p.name}</option>
		{/each}
	</select>
	<input
		type="search"
		placeholder="Search title & content…"
		value={data.q}
		oninput={(e) => setParam('q', e.currentTarget.value || null)}
	/>
</div>

{#if data.documents.length === 0}
	<p class="empty">No documents yet.</p>
{:else}
	<ul class="list">
		{#each data.documents as d (d.id)}
			<li>
				<a href={`/docs/${d.id}`}>
					<span class="title">{d.title}</span>
					<span class="meta">
						{#if projectName(d.projectId)}<span class="badge">{projectName(d.projectId)}</span>{/if}
						<span class="date">{fmtDate(d.updatedAt)}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	h1 {
		font-size: 20px;
		margin: 0;
	}
	.new {
		padding: 6px 12px;
		border-radius: 6px;
		background: var(--accent);
		color: #fff;
		text-decoration: none;
		white-space: nowrap;
	}
	.filters {
		display: flex;
		gap: 8px;
		margin: 14px 0;
	}
	.filters select,
	.filters input {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.filters input {
		flex: 1;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.list a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		text-decoration: none;
		color: inherit;
	}
	.list a:hover {
		border-color: var(--accent);
	}
	.title {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--muted);
		font-size: 12px;
		white-space: nowrap;
	}
	.empty {
		color: var(--muted);
	}
</style>
