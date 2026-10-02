<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let { data } = $props();

	const STATE_LABEL: Record<string, string> = {
		ok: 'ok',
		due: 'fällig',
		overdue: 'überfällig',
		broken: 'gerissen',
		paused: 'pausiert'
	};
	const RUN_LABEL: Record<string, string> = { done: 'erledigt', skipped: 'übersprungen', missed: 'verpasst', open: 'offen' };

	function setParam(key: string, value: string | null) {
		const params = new URLSearchParams(page.url.search);
		if (value) params.set(key, value);
		else params.delete(key);
		const qs = params.toString();
		goto(`/routines${qs ? `?${qs}` : ''}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<header class="top">
	<h1>Routinen</h1>
	<a class="new" href="/routines/new">+ Neue Routine</a>
</header>

<div class="counters">
	<div class="counter" class:hot={data.dashboard.counts.overdue > 0}>
		<strong data-counter="overdue">{data.dashboard.counts.overdue}</strong><span>überfällig</span>
	</div>
	<div class="counter">
		<strong data-counter="today">{data.dashboard.counts.today}</strong><span>heute</span>
	</div>
	<div class="counter">
		<strong data-counter="week">{data.dashboard.counts.thisWeek}</strong><span>diese Woche</span>
	</div>
</div>

<div class="filters">
	<select aria-label="Nach Person filtern" onchange={(e) => setParam('assignee', e.currentTarget.value || null)}>
		<option value="">Alle Personen</option>
		{#each data.users as u (u.id)}
			<option value={u.id} selected={data.assignee === String(u.id)}>{u.name}</option>
		{/each}
	</select>
	<select aria-label="Nach Projekt filtern" onchange={(e) => setParam('project', e.currentTarget.value || null)}>
		<option value="">Alle Projekte</option>
		{#each data.projects.filter((p) => !p.archived) as p (p.id)}
			<option value={p.id} selected={data.project === p.id}>{p.ownerId != null ? `🔒 ${p.name}` : p.name}</option>
		{/each}
	</select>
</div>

{#if data.dashboard.routines.length === 0}
	<p class="empty">Noch keine Routinen.</p>
{:else}
	<ul class="list">
		{#each data.dashboard.routines as r (r.id)}
			<li class="row" data-routine={r.id}>
				<div class="main">
					<a class="title" href={`/routines/${r.id}`}><span class="loop">↻</span> {r.title}</a>
					<span class="rhythm">{r.rhythmText}</span>
				</div>
				<div class="meta">
					{#if r.assignee}
						<span class="avatar" style="background:{r.assignee.color}" title={r.assignee.name}>{r.assignee.name[0]}</span>
					{/if}
					<span class="last">
						Letzter Lauf:
						{#if r.lastRun}
							<span class={`run ${r.lastRun.status}`}>{r.lastRun.due} ({RUN_LABEL[r.lastRun.status] ?? r.lastRun.status})</span>
						{:else}—{/if}
					</span>
					<span class="next">Nächster: {r.nextDue}</span>
					<span class={`chip ${r.state}`}>{STATE_LABEL[r.state] ?? r.state}</span>
					{#if r.task}<a class="task-link" href={`/task/${r.task.id}`}>#{r.task.id}</a>{/if}
				</div>
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
	.counters {
		display: flex;
		gap: 8px;
		margin: 14px 0;
	}
	.counter {
		flex: 1;
		display: grid;
		justify-items: center;
		padding: 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.counter strong {
		font-size: 22px;
	}
	.counter span {
		font-size: 12px;
		color: var(--muted);
	}
	.counter.hot strong {
		color: #d9480f;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0 0 14px;
	}
	.filters select {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		max-width: 100%;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 14px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.main {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.title {
		font-weight: 600;
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.title:hover {
		color: var(--accent);
	}
	.loop {
		color: var(--muted);
	}
	.rhythm {
		font-size: 12px;
		color: var(--muted);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
		font-size: 12px;
		color: var(--muted);
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		color: #fff;
		font-size: 11px;
		font-weight: 600;
	}
	.run.done {
		color: #2b8a3e;
	}
	.run.skipped {
		color: var(--muted);
	}
	.run.missed {
		color: #c92a2a;
	}
	.chip {
		padding: 2px 8px;
		border-radius: 10px;
		font-weight: 600;
		background: #e9ecef;
		color: #495057;
	}
	.chip.ok {
		background: #d3f9d8;
		color: #2b8a3e;
	}
	.chip.due {
		background: #fff3bf;
		color: #8a6d00;
	}
	.chip.overdue {
		background: #ffe8cc;
		color: #d9480f;
	}
	.chip.broken {
		background: #ffe3e3;
		color: #c92a2a;
	}
	.chip.paused {
		background: #e9ecef;
		color: #868e96;
	}
	.task-link {
		color: var(--accent);
		text-decoration: none;
	}
	.empty {
		color: var(--muted);
	}
	@media (max-width: 480px) {
		.row {
			align-items: flex-start;
		}
	}
</style>
