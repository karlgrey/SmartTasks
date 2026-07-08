<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { board } from '$lib/client/board.svelte';
	import { renderMarkdown } from '$lib/client/markdown';
	import { STATUSES, PRIORITIES, SIZES } from '$lib/types';
	import type { TaskDTO, CommentDTO, Status, Priority, Size, StatusEventDTO } from '$lib/types';

	type Detail = TaskDTO & { comments: CommentDTO[]; statusEvents: StatusEventDTO[] };

	let detail = $state<Detail | null>(null);
	let commentBody = $state('');
	let editingDescription = $state(false);
	let confirmDelete = $state(false);
	let closing = $state(false);

	const id = $derived(Number(page.params.id));

	const locationName = $derived.by(() => {
		const project = board.projects.find((p) => p.id === detail?.projectId);
		const loc = project ? board.locations.find((l) => l.id === project.locationId) : undefined;
		return loc?.name ?? '—';
	});

	$effect(() => {
		const current = id;
		detail = null;
		confirmDelete = false;
		closing = false;
		api<Detail>(`/api/tasks/${current}`)
			.then((d) => {
				if (current === id) detail = d;
			})
			.catch((e) => {
				if (current === id) {
					board.toast((e as Error).message);
					close();
				}
			});
	});

	// Remote-delete signal. Guards matter: `closing` makes this run-once — close()
	// reads page.url, which otherwise becomes a dependency of this effect, and every
	// navigation attempt re-runs it while the condition still holds (toast flood +
	// navigation loop). Consuming the signal keeps it from lingering in the store.
	$effect(() => {
		if (!closing && board.lastDeletedId === id) {
			closing = true;
			board.lastDeletedId = null;
			board.toast('Task was deleted');
			close();
		}
	});

	function close() {
		goto(`/${page.url.search}`, { noScroll: true });
	}

	async function save(patch: Partial<TaskDTO>) {
		await board.patchTask(id, patch);
		const saved = board.tasks.find((t) => t.id === id);
		if (detail && saved) detail = { ...detail, ...saved };
		if ('status' in patch) {
			const current = id;
			api<Detail>(`/api/tasks/${current}`)
				.then((d) => {
					if (current === id) detail = d;
				})
				.catch(() => {});
		}
	}

	async function addComment(e: SubmitEvent) {
		e.preventDefault();
		if (!commentBody.trim()) return;
		try {
			const comment = await api<CommentDTO>(`/api/tasks/${id}/comments`, {
				method: 'POST',
				body: JSON.stringify({ body: commentBody })
			});
			detail?.comments.push(comment);
			commentBody = '';
		} catch (err) {
			board.toast((err as Error).message);
		}
	}

	const userName = (uid: number | null) =>
		board.users.find((u) => u.id === uid)?.name ?? '—';
	const fmt = (iso: string) => iso.slice(0, 16).replace('T', ' ');
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div
	class="overlay"
	onclick={close}
	role="presentation"
	aria-label="Close panel"
></div>

<aside class="panel">
	{#if detail}
		<header>
			<span class="task-id">#{detail.id}</span>
			<input
				class="title"
				value={detail.title}
				onchange={(e) => save({ title: e.currentTarget.value })}
			/>
			<button class="close" onclick={close} aria-label="Close">×</button>
		</header>

		<div class="fields">
			<label>Status
				<select
					value={detail.status}
					onchange={(e) => save({ status: e.currentTarget.value as Status })}
				>
					{#each STATUSES as s (s)}<option>{s}</option>{/each}
				</select>
			</label>
			<label>Priority
				<select
					value={detail.priority ?? ''}
					onchange={(e) => save({ priority: (e.currentTarget.value || null) as Priority | null })}
				>
					<option value="">—</option>
					{#each PRIORITIES as p (p)}<option>{p}</option>{/each}
				</select>
			</label>
			<label>Size
				<select
					value={detail.size ?? ''}
					onchange={(e) => save({ size: (e.currentTarget.value || null) as Size | null })}
				>
					<option value="">—</option>
					{#each SIZES as s (s)}<option>{s}</option>{/each}
				</select>
			</label>
			<label>Assignee
				<select
					value={detail.assigneeId ?? ''}
					onchange={(e) => save({ assigneeId: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
				>
					<option value="">—</option>
					{#each board.users as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
				</select>
			</label>
			<label>Project
				<select
					value={detail.projectId ?? ''}
					onchange={(e) => save({ projectId: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
				>
					<option value="">—</option>
					{#each board.projects.filter((p) => !p.archived) as p (p.id)}<option value={p.id}>{board.projectLabel(p)}</option>{/each}
				</select>
			</label>
			<label>Location
				<input type="text" value={locationName} readonly tabindex="-1" />
			</label>
			<label>Due date
				<input
					type="date"
					value={detail.dueDate ?? ''}
					onchange={(e) => save({ dueDate: e.currentTarget.value || null })}
				/>
			</label>
			<label>Hours
				<input
					type="number"
					step="0.25"
					min="0"
					value={detail.hours ?? ''}
					onchange={(e) => save({ hours: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
				/>
			</label>
		</div>

		<section class="description">
			{#if editingDescription}
				<textarea
					value={detail.description}
					onblur={(e) => {
						save({ description: e.currentTarget.value });
						editingDescription = false;
					}}
				></textarea>
			{:else}
				<div
					class="rendered"
					onclick={() => (editingDescription = true)}
					onkeydown={(e) => e.key === 'Enter' && (editingDescription = true)}
					role="button"
					tabindex="0"
				>
					{#if detail.description}
						{@html renderMarkdown(detail.description)}
					{:else}
						<span class="hint">Add a description…</span>
					{/if}
				</div>
			{/if}
		</section>

		<section class="comments">
			<h3>Comments</h3>
			{#each detail.comments as c (c.id)}
				<article>
					<header>{userName(c.authorId)} · {fmt(c.createdAt)}</header>
					<div class="rendered">{@html renderMarkdown(c.body)}</div>
				</article>
			{/each}
			<form onsubmit={addComment}>
				<textarea bind:value={commentBody} placeholder="Add a comment… (Markdown)"></textarea>
				<button type="submit">Comment</button>
			</form>
		</section>

		<footer class="meta">
			<div>Created by {userName(detail.createdBy)} · {fmt(detail.createdAt)}</div>
			<div class="history">
				{#if detail.statusEvents.length === 0 && detail.completedAt}
					<div>Completed · {fmt(detail.completedAt)}</div>
				{/if}
				{#each detail.statusEvents as ev (ev.id)}
					<div>
						{ev.fromStatus ? `${ev.fromStatus} → ` : '→ '}{ev.toStatus} · {userName(ev.userId)} · {fmt(ev.createdAt)}
					</div>
				{/each}
			</div>
			<button
				class="delete"
				onclick={async () => {
					if (!confirmDelete) {
						confirmDelete = true;
						return;
					}
					if (await board.deleteTask(id)) {
						closing = true; // self-delete: suppress the remote-delete effect during unmount
						close();
					}
				}}
			>
				{confirmDelete ? 'Really delete?' : 'Delete task'}
			</button>
		</footer>
	{/if}
</aside>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.25);
		border: 0;
		z-index: 10;
	}
	.panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(480px, 95vw);
		background: var(--surface);
		border-left: 1px solid var(--border);
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
		z-index: 11;
		overflow-y: auto;
		padding: 18px;
		display: grid;
		gap: 16px;
		align-content: start;
	}
	header {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.title {
		flex: 1;
		font-size: 17px;
		font-weight: 600;
		border: 0;
		padding: 4px;
		min-width: 0;
	}
	.title:focus {
		outline: 1px solid var(--accent);
		border-radius: 4px;
	}
	.close {
		border: 0;
		background: none;
		font-size: 22px;
		cursor: pointer;
		color: var(--muted);
	}
	.fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 10px;
	}
	label {
		display: grid;
		gap: 4px;
		font-size: 12px;
		color: var(--muted);
	}
	select,
	input[type='date'],
	input[type='number'] {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		max-width: 100%;
		width: 100%;
	}
	textarea {
		width: 100%;
		min-height: 90px;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		resize: vertical;
	}
	.rendered {
		padding: 8px;
		border-radius: 6px;
		cursor: text;
		overflow-wrap: anywhere;
	}
	.rendered:hover {
		background: var(--bg);
	}
	.hint {
		color: var(--muted);
	}
	.comments {
		display: grid;
		gap: 10px;
	}
	.comments h3 {
		margin: 0;
		font-size: 13px;
	}
	.comments article {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 8px 10px;
		overflow-wrap: anywhere;
	}
	.comments article header {
		font-size: 12px;
		color: var(--muted);
	}
	.comments form {
		display: grid;
		gap: 6px;
	}
	.comments button {
		justify-self: end;
		padding: 6px 14px;
		border: 0;
		border-radius: 6px;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
	}
	.task-id {
		color: var(--muted);
		font-size: 13px;
		white-space: nowrap;
	}
	input[readonly] {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--muted);
	}
	.meta {
		font-size: 12px;
		color: var(--muted);
		display: grid;
		gap: 6px;
		justify-items: start;
	}
	.history {
		display: grid;
		gap: 2px;
	}
	.delete {
		border: 0;
		background: none;
		color: var(--danger);
		cursor: pointer;
		padding: 0;
		font-size: 12px;
	}
	@media (max-width: 767px) {
		.panel {
			width: 100vw;
			border-left: 0;
		}
		.fields {
			grid-template-columns: 1fr;
		}
		select,
		input[type='date'],
		input[type='number'] {
			min-height: 44px;
		}
	}
</style>
