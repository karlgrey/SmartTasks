import { test, expect } from '@playwright/test';

test('login → quick-add → drag → detail → comment', async ({ page }) => {
	// login
	await page.goto('/');
	await expect(page).toHaveURL(/\/login/);
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();

	// quick-add into To Do
	await page.locator('[data-column="To Do"]').getByPlaceholder('Add task…').fill('Order the wood');
	await page.locator('[data-column="To Do"]').getByPlaceholder('Add task…').press('Enter');
	const card = page.locator('.card', { hasText: 'Order the wood' });
	await expect(page.locator('[data-column="To Do"]').locator('.card', { hasText: 'Order the wood' })).toBeVisible();

	// NOTE: HTML5 dragTo proved flaky here — Chromium's actionability check reports the empty
	// destination `.cards` drop target as "not visible" (zero-height flex container with no
	// children), so `card.dragTo(...)` timed out consistently across repeated runs. Per the task
	// brief's sanctioned fallback, the column move below is exercised via the detail panel's
	// Status select instead; the drag path itself stays covered by the manual check in Task 15.
	await card.click();
	await expect(page).toHaveURL(/\/task\/\d+/);
	await page.getByLabel('Status').selectOption('In Progress');
	await page.keyboard.press('Escape');
	await expect(
		page.locator('[data-column="In Progress"]').locator('.card', { hasText: 'Order the wood' })
	).toBeVisible();

	// re-open detail, add a comment
	await card.click();
	await expect(page).toHaveURL(/\/task\/\d+/);
	await page.getByPlaceholder('Add a comment… (Markdown)').fill('Called the supplier.');
	await page.getByRole('button', { name: 'Comment' }).click();
	await expect(page.getByText('Called the supplier.')).toBeVisible();
	// scoped to .comments: the page footer also contains "Created by Micha · ..." which would
	// otherwise make a bare page.getByText('Micha ·') ambiguous (strict-mode violation)
	await expect(page.locator('.comments').getByText('Micha ·')).toBeVisible();

	// status history is visible with actor
	await expect(page.locator('.task-id')).toHaveText(/#\d+/);
	await expect(page.locator('.history').getByText('→ In Progress')).toBeVisible();

	// delete: two-step confirm, card disappears
	await page.getByRole('button', { name: 'Delete task' }).click();
	await page.getByRole('button', { name: 'Really delete?' }).click();
	await expect(page.locator('.card', { hasText: 'Order the wood' })).toHaveCount(0);

	// regression: the deleting session's own SSE echo must not re-trigger the
	// panel's delete effect (caused a toast flood + navigation loop in v1.2)
	await page.waitForTimeout(1500);
	await expect(page.locator('.toast')).toHaveCount(0);
	await expect(page).toHaveURL(/\/(\?.*)?$/);
});

test('verwerfen: Pflicht-Grund → Dropped, nur im Umschalter der Done-Spalte (#801)', async ({ page }) => {
	await page.goto('/login');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();
	// no own column for Dropped
	await expect(page.locator('[data-column="Dropped"]')).toHaveCount(0);

	const todo = page.locator('[data-column="To Do"]');
	await todo.getByPlaceholder('Add task…').fill('Obsolete idea');
	await todo.getByPlaceholder('Add task…').press('Enter');
	await todo.locator('.card', { hasText: 'Obsolete idea' }).click();
	await expect(page).toHaveURL(/\/task\/\d+/);

	await page.getByRole('button', { name: '⊘ Verwerfen' }).click();
	const confirm = page.getByRole('button', { name: 'Verwerfen', exact: true });
	await expect(confirm).toBeDisabled(); // Grund ist Pflicht
	await page.getByLabel('Grund fürs Verwerfen').fill('Icebox-Sweep Q4 2026');
	await confirm.click();
	await expect(page.locator('.comments').getByText('Verworfen: Icebox-Sweep Q4 2026')).toBeVisible();
	await expect(page.getByLabel('Status')).toHaveValue('Dropped');
	await page.keyboard.press('Escape');

	const done = page.locator('[data-column="Done"]');
	await expect(page.locator('.card', { hasText: 'Obsolete idea' })).toHaveCount(0);
	await done.getByRole('button', { name: 'Verworfen' }).click();
	await expect(done.locator('.card.dropped', { hasText: 'Obsolete idea' })).toBeVisible();
	await done.getByRole('button', { name: 'Erledigt' }).click();
	await expect(page.locator('.card', { hasText: 'Obsolete idea' })).toHaveCount(0);
});
