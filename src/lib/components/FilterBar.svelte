<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { board } from '$lib/client/board.svelte';

	const current = $derived(new URLSearchParams(page.url.search));

	let pwDialog: HTMLDialogElement | undefined = $state();
	let currentPassword = $state('');
	let newPassword = $state('');
	let newPasswordRepeat = $state('');
	let pwMessage = $state('');
	let pwError = $state('');
	let pwBusy = $state(false);

	function resetPwForm() {
		currentPassword = '';
		newPassword = '';
		newPasswordRepeat = '';
		pwMessage = '';
		pwError = '';
	}

	function openPwDialog() {
		resetPwForm();
		pwDialog?.showModal();
	}

	function translatePwError(error: string): string {
		switch (error) {
			case 'current password is wrong':
				return 'Aktuelles Passwort ist falsch.';
			case 'password too short':
				return 'Neues Passwort muss mindestens 8 Zeichen haben.';
			case 'password unchanged':
				return 'Neues Passwort muss sich vom aktuellen unterscheiden.';
			case 'user has no password':
				return 'Für diesen Account ist kein Passwort hinterlegt.';
			default:
				return 'Passwort konnte nicht geändert werden.';
		}
	}

	async function submitPwChange(e: SubmitEvent) {
		e.preventDefault();
		pwError = '';
		pwMessage = '';
		if (newPassword.length < 8) {
			pwError = 'Neues Passwort muss mindestens 8 Zeichen haben.';
			return;
		}
		if (newPassword !== newPasswordRepeat) {
			pwError = 'Die Wiederholung stimmt nicht mit dem neuen Passwort überein.';
			return;
		}
		pwBusy = true;
		try {
			const res = await fetch('/api/auth/password', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				pwError = translatePwError(data.error ?? '');
				return;
			}
			pwMessage = 'Passwort geändert.';
			setTimeout(() => pwDialog?.close(), 1200);
		} catch {
			pwError = 'Passwort konnte nicht geändert werden.';
		} finally {
			pwBusy = false;
		}
	}

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

	function toggleToday() {
		setParam('today', current.get('today') === 'true' ? null : 'true');
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
			data-user-id={u.id}
			onclick={() => toggleAssignee(u.id)}
		>
			{u.name}{#if u.type === 'ai'}<span class="ai">AI</span>{/if}
		</button>
	{/each}
	<select onchange={(e) => setParam('project', e.currentTarget.value || null)}>
		<option value="">All projects</option>
		{#each board.projects.filter((p) => !p.archived) as p (p.id)}
			<option value={p.id} selected={current.get('project') === String(p.id)}>{p.ownerId != null ? `🔒 ${p.name}` : p.name}</option>
		{/each}
	</select>
	<select onchange={(e) => setParam('location', e.currentTarget.value || null)}>
		<option value="">All locations</option>
		{#each board.locations.filter((l) => !l.archived) as l (l.id)}
			<option value={l.id} selected={current.get('location') === String(l.id)}>{l.name}</option>
		{/each}
	</select>
	<button
		class="chip"
		class:active={current.get('today') === 'true'}
		style="--c:var(--accent)"
		onclick={toggleToday}
	>
		Today
	</button>
	<input
		type="search"
		placeholder="Search…"
		value={current.get('q') ?? ''}
		oninput={(e) => setParam('q', e.currentTarget.value || null)}
	/>
	<span class="spacer"></span>
	{#if board.me?.type === 'ai'}
		<span class="me">{board.me?.name}</span>
	{:else}
		<button class="me" onclick={openPwDialog}>{board.me?.name}</button>
	{/if}
	<button
		class="logout"
		onclick={async () => {
			// Confirm ist dauerhaft (Micha, 21.08.2026): schützt vor Fehlklicks.
			// Der Quell-Marker unterscheidet im auth-debug-Log (#453) Button-
			// Logouts von allem, was den Endpoint sonst noch aufrufen könnte.
			if (!confirm('Wirklich ausloggen?')) return;
			await fetch('/api/auth/logout', {
				method: 'POST',
				headers: { 'x-logout-source': 'filterbar-confirmed' }
			});
			location.href = '/login';
		}}>Logout</button
	>
</nav>

<dialog bind:this={pwDialog} class="pw-dialog">
	<form onsubmit={submitPwChange}>
		<h2>Passwort ändern</h2>
		<label>
			Aktuelles Passwort
			<input type="password" autocomplete="current-password" bind:value={currentPassword} required />
		</label>
		<label>
			Neues Passwort
			<input type="password" autocomplete="new-password" bind:value={newPassword} required minlength="8" />
		</label>
		<label>
			Neues Passwort wiederholen
			<input
				type="password"
				autocomplete="new-password"
				bind:value={newPasswordRepeat}
				required
				minlength="8"
			/>
		</label>
		{#if pwError}
			<p class="pw-error">{pwError}</p>
		{/if}
		{#if pwMessage}
			<p class="pw-success">{pwMessage}</p>
		{/if}
		<div class="pw-actions">
			<button type="button" onclick={() => pwDialog?.close()}>Abbrechen</button>
			<button type="submit" disabled={pwBusy}>Speichern</button>
		</div>
	</form>
</dialog>

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
		border: 0;
		background: none;
		color: var(--muted);
		font: inherit;
		padding: 0;
	}
	button.me {
		cursor: pointer;
	}
	button.me:hover {
		text-decoration: underline;
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
	.pw-dialog {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0;
		width: min(360px, calc(100vw - 32px));
		background: var(--surface);
		color: inherit;
	}
	.pw-dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	.pw-dialog form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 18px;
	}
	.pw-dialog h2 {
		margin: 0 0 4px 0;
		font-size: 16px;
	}
	.pw-dialog label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--muted);
	}
	.pw-dialog input {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 14px;
	}
	.pw-error {
		color: #c0392b;
		font-size: 13px;
		margin: 0;
	}
	.pw-success {
		color: #2e7d32;
		font-size: 13px;
		margin: 0;
	}
	.pw-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
	.pw-actions button {
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--surface);
		cursor: pointer;
	}
	.pw-actions button[type='submit'] {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
</style>
