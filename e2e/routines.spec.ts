import { test, expect } from '@playwright/test';

// Etappe 1 (#795): nur API — UI folgt in Etappe 2.
test('routines API: create → dashboard → materialize creates a linked task', async ({ page }) => {
	await page.goto('/login');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();

	const projects = await (await page.request.get('/api/projects')).json();
	const created = await page.request.post('/api/routines', {
		data: { title: 'E2E Routine', projectId: projects[0].id, rhythm: { unit: 'month', interval: 1, dayOfMonth: 15 } }
	});
	expect(created.status()).toBe(201);
	const routine = await created.json();

	const dash = await page.request.get('/api/routines/dashboard');
	expect(dash.status()).toBe(200);
	const body = await dash.json();
	expect(body.counts).toEqual({ overdue: expect.any(Number), today: expect.any(Number), thisWeek: expect.any(Number) });
	expect(body.routines.some((r: { id: number }) => r.id === routine.id)).toBe(true);

	const mat = await page.request.post(`/api/routines/${routine.id}/materialize`, { data: {} });
	expect(mat.status()).toBe(201);
	const { task, run } = await mat.json();
	expect(task.title).toMatch(/^E2E Routine · /);
	expect(task.routineRunId).toBe(run.id);

	const detail = await (await page.request.get(`/api/tasks/${task.id}`)).json();
	expect(detail.routine).toEqual({ id: routine.id, title: 'E2E Routine' });

	const tick = await page.request.post('/api/routines/tick');
	expect(tick.status()).toBe(200);
});
