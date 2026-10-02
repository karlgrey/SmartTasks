<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import RhythmFields from '$lib/components/RhythmFields.svelte';
	import type { Rhythm, RhythmUnit, RoutineDTO } from '$lib/types';

	let { data } = $props();

	const defaultLead = (unit: RhythmUnit) => (unit === 'day' ? 0 : unit === 'week' ? 1 : 3);

	let title = $state('');
	let description = $state('');
	let projectId = $state<number | ''>('');
	let assigneeId = $state<number | ''>('');
	let rhythm = $state<Rhythm>({ unit: 'month', interval: 1, dayOfMonth: 1 });
	let leadDays = $state(defaultLead('month'));
	let materialize = $state(true);
	let error = $state('');
	let saving = $state(false);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim() || projectId === '' || saving) return;
		saving = true;
		error = '';
		try {
			const r = await api<RoutineDTO>('/api/routines', {
				method: 'POST',
				body: JSON.stringify({
					title: title.trim(),
					description,
					projectId: Number(projectId),
					assigneeId: assigneeId === '' ? null : Number(assigneeId),
					rhythm,
					leadDays: Number(leadDays),
					materialize
				})
			});
			goto(`/routines/${r.id}`);
		} catch (err) {
			error = (err as Error).message;
			saving = false;
		}
	}
</script>

<h1>Neue Routine</h1>

<form onsubmit={create}>
	<input class="title" type="text" placeholder="Titel" aria-label="Titel" bind:value={title} />
	<div class="row">
		<label>
			<span>Projekt</span>
			<select bind:value={projectId} aria-label="Projekt">
				<option value="">Projekt wählen…</option>
				{#each data.projects.filter((p) => !p.archived) as p (p.id)}
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
	<RhythmFields bind:rhythm onunitchange={(u) => (leadDays = defaultLead(u))} />
	<div class="row">
		<label>
			<span>Vorlauf (Tage)</span>
			<input type="number" min="0" aria-label="Vorlauf" bind:value={leadDays} />
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={materialize} /> erzeugt Task
		</label>
	</div>
	<textarea placeholder="Beschreibung (Markdown)…" aria-label="Beschreibung" bind:value={description}></textarea>
	{#if error}<p class="error">{error}</p>{/if}
	<div class="actions">
		<a href="/routines">Abbrechen</a>
		<button type="submit" disabled={!title.trim() || projectId === '' || saving}>Anlegen</button>
	</div>
</form>

<style>
	h1 {
		font-size: 20px;
	}
	form {
		display: grid;
		gap: 12px;
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
		min-width: 0;
	}
	.title,
	textarea {
		width: 100%;
	}
	textarea {
		min-height: 160px;
		resize: vertical;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
	label.check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		color: inherit;
		padding-bottom: 8px;
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
