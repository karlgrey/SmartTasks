<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import type { DocumentDTO } from '$lib/types';

	let { data } = $props();

	let title = $state('');
	let body = $state('');
	let projectId = $state<number | ''>('');
	let error = $state('');
	let saving = $state(false);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim() || saving) return;
		saving = true;
		error = '';
		try {
			const doc = await api<DocumentDTO>('/api/documents', {
				method: 'POST',
				body: JSON.stringify({
					title: title.trim(),
					body,
					projectId: projectId === '' ? null : Number(projectId)
				})
			});
			goto(`/docs/${doc.id}`);
		} catch (err) {
			error = (err as Error).message;
			saving = false;
		}
	}
</script>

<h1>New document</h1>

<form onsubmit={create}>
	<input class="title" type="text" placeholder="Title" bind:value={title} />
	<select bind:value={projectId} aria-label="Project">
		<option value="">No project</option>
		{#each data.projects.filter((p) => !p.archived) as p (p.id)}
			<option value={p.id}>{p.name}</option>
		{/each}
	</select>
	<textarea placeholder="Write Markdown…" bind:value={body}></textarea>
	{#if error}<p class="error">{error}</p>{/if}
	<div class="actions">
		<a href="/docs">Cancel</a>
		<button type="submit" disabled={!title.trim() || saving}>Create</button>
	</div>
</form>

<style>
	h1 {
		font-size: 20px;
	}
	form {
		display: grid;
		gap: 10px;
	}
	.title {
		font-size: 17px;
		font-weight: 600;
	}
	input,
	select,
	textarea {
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		width: 100%;
	}
	textarea {
		min-height: 260px;
		resize: vertical;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 14px;
	}
	.actions a {
		color: var(--muted);
		text-decoration: none;
	}
	button {
		padding: 8px 16px;
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
	.error {
		color: var(--danger);
	}
</style>
