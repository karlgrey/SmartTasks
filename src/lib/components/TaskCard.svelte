<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { board } from '$lib/client/board.svelte';
	import type { TaskDTO } from '$lib/types';

	let { task }: { task: TaskDTO } = $props();

	const assignee = $derived(board.users.find((u) => u.id === task.assigneeId));
	const project = $derived(board.projects.find((p) => p.id === task.projectId));
	const location = $derived(
		project ? board.locations.find((l) => l.id === project.locationId) : undefined
	);
	const overdue = $derived(
		!!task.dueDate && task.status !== 'Done' && task.dueDate < new Date().toISOString().slice(0, 10)
	);
</script>

<button
	class="card"
	class:flash={board.flashes[task.id]}
	draggable="true"
	ondragstart={(e) => e.dataTransfer?.setData('text/task-id', String(task.id))}
	onclick={() => goto(`/task/${task.id}${page.url.search}`)}
>
	<span class="ticket-id">#{task.id}</span>
	<span class="title">{task.title}</span>
	<span class="meta">
		{#if task.priority}<span class="badge prio-{task.priority.toLowerCase()}">{task.priority}</span>{/if}
		{#if task.size}<span class="badge">{task.size}</span>{/if}
		{#if project}<span class="badge" style="background:{project.color}22;color:{project.color}">{project.ownerId != null ? '🔒 ' : ''}{project.name}</span>{/if}
		{#if location}<span class="badge">{location.name}</span>{/if}
		{#if task.dueDate}<span class="badge" class:overdue>{task.dueDate}</span>{/if}
		{#if assignee}<span class="avatar" style="background:{assignee.color}" title={assignee.name}>{assignee.name[0]}</span>{/if}
	</span>
</button>

<style>
	.card {
		position: relative;
		display: grid;
		gap: 6px;
		width: 100%;
		padding: 10px;
		padding-right: 28px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow);
		cursor: pointer;
		text-align: left;
	}
	.ticket-id {
		position: absolute;
		top: 4px;
		right: 6px;
		font-size: 8px;
		color: var(--muted);
	}
	.card:hover {
		border-color: var(--accent);
	}
	.card.flash {
		animation: flash 1.5s ease-out;
	}
	@keyframes flash {
		0% { background: #dbeafe; }
		100% { background: var(--surface); }
	}
	.title {
		font-weight: 500;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
	}
</style>
