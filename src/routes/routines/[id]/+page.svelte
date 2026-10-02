<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { renderMarkdown } from '$lib/client/markdown';
	import RhythmFields from '$lib/components/RhythmFields.svelte';
	import { rhythmText } from '$lib/rhythm';
	import type { Rhythm, RoutineDTO, RoutineRunDTO, TaskDTO } from '$lib/types';

	let { data } = $props();

	type Detail = RoutineDTO & {
		runs: RoutineRunDTO[];
		openTask: { id: number; title: string; status: string; dueDate: string | null } | null;
		project: { id: number; name: string } | null;
		assignee: { id: number; name: string } | null;
	};

	const RUN_LABEL: Record<string, string> = { open: 'offen', done: 'erledigt', skipped: 'übersprungen', missed: 'verpasst' };

	let routine = $state<Detail | null>(null);
	let error = $state('');
	let info = $state('');
	let confirmDelete = $state(false);
	let saving = $state(false);

	let title = $state('');
	let description = $state('');
	let editDesc = $state(false);
	let projectId = $state<number | ''>('');
	let assigneeId = $state<number | ''>('');
	let rhythm = $state<Rhythm>({ unit: 'month', interval: 1 });
	let leadDays = $state(0);
	let materialize = $state(true);
	let active = $state(true);

	const id = $derived(Number(page.params.id));
	const isHuman = $derived(data.user.type === 'human');
	const showReport = $derived(routine ? !routine.materialize || !routine.openTask : false);

	function fill(r: Detail) {
		title = r.title;
		description = r.description;
		projectId = r.projectId;
		assigneeId = r.assigneeId ?? '';
		rhythm = { ...r.rhythm };
		leadDays = r.leadDays;
		materialize = r.materialize;
		active = r.active;
	}

	async function load(current: number) {
		try {
			const r = await api<Detail>(`/api/routines/${current}`);
			if (current === id) {
				routine = r;
				fill(r);
			}
		} catch (e) {
			if (current === id) error = (e as Error).message;
		}
	}

	$effect(() => {
		const current = id;
		routine = null;
		error = '';
		info = '';
		confirmDelete = false;
		editDesc = false;
		load(current);
	});

	async function save() {
		if (!routine || !title.trim() || projectId === '' || saving) return;
		saving = true;
		error = '';
		info = '';
		try {
			await api<RoutineDTO>(`/api/routines/${id}`, {
				method: 'PATCH',
				body: JSON.stringify({
					title: title.trim(),
					description,
					projectId: Number(projectId),
					assigneeId: assigneeId === '' ? null : Number(assigneeId),
					rhythm,
					leadDays: Number(leadDays),
					materialize,
					active
				})
			});
			editDesc = false;
			await load(id);
			info = 'Gespeichert.';
		} catch (e) {
			error = (e as Error).message;
		} finally {
			saving = false;
		}
	}

	async function materializeNow() {
		error = '';
		try {
			const res = await api<{ task: TaskDTO }>(`/api/routines/${id}/materialize`, { method: 'POST', body: '{}' });
			goto(`/task/${res.task.id}`);
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function reportDone() {
		error = '';
		try {
			await api(`/api/routines/${id}/runs`, { method: 'POST', body: JSON.stringify({ status: 'done' }) });
			await load(id);
			info = 'Lauf als erledigt gemeldet.';
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function del() {
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		try {
			await api(`/api/routines/${id}`, { method: 'DELETE' });
			goto('/routines');
		} catch (e) {
			error = (e as Error).message;
			confirmDelete = false;
		}
	}

	const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if info}<p class="info">{info}</p>{/if}

{#if routine}
	<header class="head">
		<h1><span class="loop">↻</span> {routine.title}</h1>
		<span class="rid">#{routine.id}</span>
	</header>
	<p class="summary">
		{rhythmText(routine.rhythm)} · Nächster Lauf: <strong data-testid="next-due">{routine.nextDue}</strong>
		{#if !routine.active}· <em>pausiert</em>{/if}
		{#if routine.openTask}· offener Task: <a href={`/task/${routine.openTask.id}`}>#{routine.openTask.id} {routine.openTask.title}</a>{/if}
	</p>

	<div class="actions-top">
		<button onclick={materializeNow}>Lauf jetzt anlegen</button>
		{#if showReport}<button class="ghost" onclick={reportDone}>Lauf als erledigt melden</button>{/if}
	</div>

	<section class="form">
		<label class="wide">
			<span>Titel</span>
			<input type="text" aria-label="Titel" bind:value={title} />
		</label>
		<div class="row">
			<label>
				<span>Projekt</span>
				<select bind:value={projectId} aria-label="Projekt">
					{#each data.projects.filter((p) => !p.archived || p.id === routine?.projectId) as p (p.id)}
						<option value={p.id}>{p.ownerId != null ? `🔒 ${p.name}` : p.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Zuständig</span>
				<select bind:value={assigneeId} aria-label="Zuständiger">
					<option value="">Niemand</option>
					{#each data.users as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
				</select>
			</label>
		</div>
		<RhythmFields bind:rhythm />
		<div class="row">
			<label>
				<span>Vorlauf (Tage)</span>
				<input type="number" min="0" aria-label="Vorlauf" bind:value={leadDays} />
			</label>
			<label class="check"><input type="checkbox" bind:checked={materialize} /> erzeugt Task</label>
			<label class="check"><input type="checkbox" bind:checked={active} /> aktiv</label>
		</div>

		<div class="desc">
			<div class="desc-head">
				<span>Beschreibung</span>
				{#if !editDesc}<button class="ghost small" onclick={() => (editDesc = true)}>Bearbeiten</button>{/if}
			</div>
			{#if editDesc}
				<textarea aria-label="Beschreibung" bind:value={description} placeholder="Markdown…"></textarea>
			{:else if description.trim()}
				<article class="rendered">{@html renderMarkdown(description)}</article>
			{:else}
				<p class="hint">Keine Beschreibung.</p>
			{/if}
		</div>

		<div class="save-row">
			<button onclick={save} disabled={!title.trim() || projectId === '' || saving}>Speichern</button>
		</div>
	</section>

	<section class="history">
		<h2>Lauf-Historie</h2>
		{#if routine.runs.length === 0}
			<p class="hint">Noch keine Läufe.</p>
		{:else}
			<ul>
				{#each routine.runs as run (run.id)}
					<li class="run" data-run={run.id}>
						<span class="due">{run.due}</span>
						<span class={`st ${run.status}`}>{RUN_LABEL[run.status] ?? run.status}</span>
						{#if run.doneAt}<span class="muted">{fmt(run.doneAt)}</span>{/if}
						{#if run.note}<span class="note">{run.note}</span>{/if}
						{#if run.taskId}<a href={`/task/${run.taskId}`}>#{run.taskId}</a>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if isHuman}
		<footer>
			<button class="delete" onclick={del}>{confirmDelete ? 'Wirklich löschen?' : 'Routine löschen'}</button>
		</footer>
	{/if}
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	h1 {
		font-size: 22px;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.loop,
	.rid,
	.muted,
	.hint {
		color: var(--muted);
	}
	.summary {
		margin: 6px 0 12px;
		font-size: 13px;
		color: var(--muted);
	}
	.summary a {
		color: var(--accent);
	}
	.actions-top {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 16px;
	}
	.form {
		display: grid;
		gap: 12px;
		padding: 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
	}
	label {
		display: grid;
		gap: 3px;
		font-size: 12px;
		color: var(--muted);
	}
	label.wide input {
		width: 100%;
	}
	label.check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		color: inherit;
		padding-bottom: 8px;
	}
	input,
	select,
	textarea {
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		min-width: 0;
	}
	textarea {
		width: 100%;
		min-height: 160px;
		resize: vertical;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.desc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		color: var(--muted);
		margin-bottom: 4px;
	}
	.rendered {
		overflow-wrap: anywhere;
	}
	.rendered :global(pre) {
		overflow-x: auto;
	}
	.save-row {
		display: flex;
		justify-content: flex-end;
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
	button.small {
		padding: 2px 8px;
		font-size: 12px;
	}
	.history {
		margin-top: 24px;
	}
	.history h2 {
		font-size: 14px;
		margin: 0 0 8px;
	}
	.history ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.run {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		align-items: baseline;
		padding: 8px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 13px;
	}
	.run a {
		color: var(--accent);
		text-decoration: none;
	}
	.note {
		overflow-wrap: anywhere;
	}
	.st.done {
		color: #2b8a3e;
	}
	.st.skipped {
		color: var(--muted);
	}
	.st.missed {
		color: #c92a2a;
	}
	.st.open {
		color: #8a6d00;
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
	.error {
		color: var(--danger);
	}
	.info {
		color: #2b8a3e;
	}
</style>
