import { test, expect } from '@playwright/test';

// The two tests share state on purpose (project/task created in the first
// persist in the shared SQLite DB for the second) — serial makes that
// dependency explicit so a `--grep`-scoped single run fails loudly instead
// of mysteriously, and so the second never runs after the first failed.
test.describe.serial('private projects', () => {
	test('private project is invisible to other users', async ({ page, request }) => {
		// Micha logs in via API and creates a private project + task
		const login = await request.post('/api/auth/login', {
			data: { email: 'micha@e2e.test', password: 'e2e-password-1' }
		});
		expect(login.ok()).toBeTruthy();
		const me = await (await request.get('/api/users')).json();
		const michaId = me.find((u: { name: string }) => u.name === 'Micha').id;
		const project = await (
			await request.post('/api/projects', { data: { name: 'Privat E2E', ownerId: michaId } })
		).json();
		const task = await (
			await request.post('/api/tasks', { data: { title: 'Geheimer Task', projectId: project.id, status: 'To Do' } })
		).json();

		// Ulf logs in via UI: neither project nor task anywhere
		await page.goto('/login');
		await page.getByPlaceholder('Email').fill('ulf@e2e.test');
		await page.getByPlaceholder('Password').fill('e2e-password-2');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.locator('[data-column="To Do"]')).toBeVisible();
		await expect(page.locator('.card', { hasText: 'Geheimer Task' })).toHaveCount(0);
		await expect(page.locator('option', { hasText: 'Privat E2E' })).toHaveCount(0);
		const detail = await page.request.get(`/api/tasks/${task.id}`);
		expect(detail.status()).toBe(404);
	});

	test('owner sees the private project with a lock marker', async ({ page }) => {
		// depends on the previous test's setup: Playwright runs tests of one file
		// serially in the same worker (playwright.config.ts), and the project/task
		// created above persist in the shared SQLite DB.
		await page.goto('/login');
		await page.getByPlaceholder('Email').fill('micha@e2e.test');
		await page.getByPlaceholder('Password').fill('e2e-password-1');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.locator('.card', { hasText: 'Geheimer Task' })).toBeVisible();
		await expect(page.locator('option', { hasText: '🔒 Privat E2E' })).toHaveCount(1);
	});
});
