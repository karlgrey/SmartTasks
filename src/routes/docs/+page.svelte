<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { DocumentDTO } from '$lib/types';

	let { data } = $props();

	// Server already orders pinned-first (documents-service listDocuments);
	// split into two lists here purely for the pinned section's own markup.
	const pinnedDocs = $derived(data.documents.filter((d) => d.pinned));
	const otherDocs = $derived(data.documents.filter((d) => !d.pinned));

	const projectName = (id: number | null) => {
		const p = data.projects.find((p) => p.id === id);
		return p ? `${p.ownerId != null ? '🔒 ' : ''}${p.name}` : null;
	};
	const fmtDate = (iso: string) => iso.slice(0, 10);

	function setParam(key: string, value: string | null) {
		const params = new URLSearchParams(page.url.search);
		if (value) params.set(key, value);
		else params.delete(key);
		const qs = params.toString();
		goto(`/docs${qs ? `?${qs}` : ''}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

{#snippet docRow(d: DocumentDTO)}
	<li>
		<a href={`/docs/${d.id}`}>
			<span class="title">{d.title}</span>
			<span class="meta">
				{#if projectName(d.projectId)}<span class="badge">{projectName(d.projectId)}</span>{/if}
				<span class="date">{fmtDate(d.updatedAt)}</span>
			</span>
		</a>
	</li>
{/snippet}

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
			<option value={p.id} selected={data.project === p.id}>{p.ownerId != null ? `🔒 ${p.name}` : p.name}</option>
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
	{#if pinnedDocs.length > 0}
		<section class="pinned-section">
			<h2 class="section-label">📌 Pinned</h2>
			<ul class="list pinned-list">
				{#each pinnedDocs as d (d.id)}
					{@render docRow(d)}
				{/each}
			</ul>
		</section>
	{/if}
	<ul class="list">
		{#each otherDocs as d (d.id)}
			{@render docRow(d)}
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
	.pinned-section {
		margin-bottom: 16px;
		padding: 10px;
		background: color-mix(in srgb, var(--accent) 6%, var(--surface));
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.section-label {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--muted);
	}
	.pinned-section .list {
		margin: 0;
	}
	.pinned-section .list a {
		background: var(--bg);
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
