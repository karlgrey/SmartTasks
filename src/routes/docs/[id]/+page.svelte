<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { renderMarkdown } from '$lib/client/markdown';
	import type { DocumentDTO, TaskRefDTO, TaskDTO } from '$lib/types';

	let { data } = $props();

	type Detail = DocumentDTO & { tasks: TaskRefDTO[] };

	let doc = $state<Detail | null>(null);
	let error = $state('');
	let editing = $state(false);
	let editTitle = $state('');
	let editBody = $state('');
	let editProject = $state<number | ''>('');
	let confirmDelete = $state(false);
	let allTasks = $state<TaskDTO[]>([]);

	const id = $derived(Number(page.params.id));
	const isHuman = $derived(data.user.type === 'human');
	const projectName = $derived(data.projects.find((p) => p.id === doc?.projectId)?.name ?? null);
	const userName = (uid: number) => data.users.find((u) => u.id === uid)?.name ?? '—';
	const fmt = (iso: string) => iso.slice(0, 16).replace('T', ' ');

	$effect(() => {
		const current = id;
		doc = null;
		error = '';
		confirmDelete = false;
		api<Detail>(`/api/documents/${current}`)
			.then((d) => {
				if (current === id) doc = d;
			})
			.catch((e) => {
				if (current === id) error = (e as Error).message;
			});
	});

	// Tasks available to link (fetched lazily, open tasks)
	async function ensureTasks() {
		if (allTasks.length === 0) allTasks = await api<TaskDTO[]>('/api/tasks?open=true');
	}

	const linkableTasks = $derived(
		allTasks.filter((t) => !doc?.tasks.some((lt) => lt.id === t.id))
	);

	function startEdit() {
		if (!doc) return;
		editTitle = doc.title;
		editBody = doc.body;
		editProject = doc.projectId ?? '';
		editing = true;
	}

	async function saveEdit() {
		if (!doc || !editTitle.trim()) return;
		try {
			const saved = await api<DocumentDTO>(`/api/documents/${id}`, {
				method: 'PATCH',
				body: JSON.stringify({
					title: editTitle.trim(),
					body: editBody,
					projectId: editProject === '' ? null : Number(editProject)
				})
			});
			doc = { ...doc, ...saved };
			editing = false;
		} catch (err) {
			error = (err as Error).message;
		}
	}

	async function linkTask(taskId: number) {
		if (!taskId || !doc) return;
		try {
			await api(`/api/documents/${id}/tasks`, {
				method: 'POST',
				body: JSON.stringify({ taskId })
			});
			doc = await api<Detail>(`/api/documents/${id}`);
		} catch (err) {
			error = (err as Error).message;
		}
	}

	async function unlinkTask(taskId: number) {
		if (!doc) return;
		try {
			await api(`/api/documents/${id}/tasks/${taskId}`, { method: 'DELETE' });
			doc.tasks = doc.tasks.filter((t) => t.id !== taskId);
		} catch (err) {
			error = (err as Error).message;
		}
	}

	async function del() {
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		try {
			await api(`/api/documents/${id}`, { method: 'DELETE' });
			goto('/docs');
		} catch (err) {
			error = (err as Error).message;
			confirmDelete = false;
		}
	}
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if doc}
	{#if editing}
		<div class="editor">
			<input class="title-input" type="text" bind:value={editTitle} placeholder="Title" />
			<select bind:value={editProject} aria-label="Project">
				<option value="">No project</option>
				{#each data.projects.filter((p) => !p.archived) as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
			<div class="split">
				<textarea bind:value={editBody} placeholder="Write Markdown…"></textarea>
				<div class="preview rendered">{@html renderMarkdown(editBody)}</div>
			</div>
			<div class="actions">
				<button class="ghost" onclick={() => (editing = false)}>Cancel</button>
				<button onclick={saveEdit} disabled={!editTitle.trim()}>Save</button>
			</div>
		</div>
	{:else}
		<header class="doc-header">
			<h1>{doc.title}</h1>
			<button class="ghost" onclick={startEdit}>Edit</button>
		</header>
		<div class="meta">
			{#if projectName}<a class="badge" href={`/docs?project=${doc.projectId}`}>{projectName}</a>{/if}
			<span>Created by {userName(doc.createdBy)}</span>
			<span>· Updated {fmt(doc.updatedAt)}</span>
		</div>

		<article class="rendered body">
			{#if doc.body.trim()}
				{@html renderMarkdown(doc.body)}
			{:else}
				<span class="hint">This document is empty. Click Edit to add content.</span>
			{/if}
		</article>
	{/if}

	<section class="links">
		<h2>Linked tasks</h2>
		{#if doc.tasks.length === 0}
			<p class="hint">No linked tasks.</p>
		{:else}
			<ul>
				{#each doc.tasks as t (t.id)}
					<li>
						<a href={`/task/${t.id}`}>#{t.id} {t.title}</a>
						<span class="status">{t.status}</span>
						<button class="unlink" aria-label="Unlink task" onclick={() => unlinkTask(t.id)}>×</button>
					</li>
				{/each}
			</ul>
		{/if}
		<select
			aria-label="Link a task"
			onfocus={ensureTasks}
			onchange={(e) => {
				linkTask(Number(e.currentTarget.value));
				e.currentTarget.value = '';
			}}
		>
			<option value="">+ Link a task…</option>
			{#each linkableTasks as t (t.id)}
				<option value={t.id}>#{t.id} {t.title}</option>
			{/each}
		</select>
	</section>

	{#if isHuman}
		<footer>
			<button class="delete" onclick={del}>
				{confirmDelete ? 'Really delete?' : 'Delete document'}
			</button>
		</footer>
	{/if}
{/if}

<style>
	.doc-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	h1 {
		font-size: 22px;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		color: var(--muted);
		font-size: 12px;
		margin: 8px 0 20px;
	}
	.meta a.badge {
		text-decoration: none;
	}
	.body {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 16px 18px;
	}
	.rendered {
		overflow-wrap: anywhere;
	}
	.rendered :global(pre) {
		overflow-x: auto;
	}
	.hint {
		color: var(--muted);
	}
	.editor {
		display: grid;
		gap: 10px;
	}
	.title-input {
		font-size: 18px;
		font-weight: 600;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.editor select {
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		justify-self: start;
	}
	.split {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.split textarea {
		min-height: 340px;
		padding: 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		resize: vertical;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.preview {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 10px 14px;
		background: var(--surface);
		overflow-y: auto;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
	}
	button {
		padding: 7px 14px;
		border: 0;
		border-radius: 6px;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.ghost {
		background: none;
		color: var(--accent);
		border: 1px solid var(--border);
	}
	.links {
		margin-top: 28px;
	}
	.links h2 {
		font-size: 14px;
		margin: 0 0 8px;
	}
	.links ul {
		list-style: none;
		margin: 0 0 10px;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.links li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.links li a {
		color: var(--accent);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.status {
		color: var(--muted);
		font-size: 12px;
	}
	.unlink {
		margin-left: auto;
		background: none;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0 8px;
	}
	.links select {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	footer {
		margin-top: 32px;
	}
	.delete {
		background: none;
		color: var(--danger);
		padding: 0;
		font-size: 13px;
	}
	@media (max-width: 640px) {
		.split {
			grid-template-columns: 1fr;
		}
	}
</style>
