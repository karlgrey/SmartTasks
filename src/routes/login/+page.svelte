<script lang="ts">
	let email = $state('');
	let password = $state('');
	let error = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const res = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, password })
		});
		if (res.ok) location.href = '/';
		else error = (await res.json()).error ?? 'login failed';
	}
</script>

<svelte:head><title>SmartTasks — Login</title></svelte:head>

<main>
	<form onsubmit={submit}>
		<h1>SmartTasks</h1>
		<input type="email" placeholder="Email" bind:value={email} required />
		<input type="password" placeholder="Password" bind:value={password} required />
		{#if error}<p class="error">{error}</p>{/if}
		<button type="submit">Sign in</button>
	</form>
</main>

<style>
	main {
		display: grid;
		place-items: center;
		min-height: 100vh;
	}
	form {
		display: grid;
		gap: 10px;
		width: 300px;
		padding: 28px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	h1 {
		margin: 0 0 8px;
		font-size: 20px;
	}
	input {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	button {
		padding: 8px;
		border: 0;
		border-radius: 6px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.error {
		margin: 0;
		color: var(--danger);
		font-size: 13px;
	}
</style>
