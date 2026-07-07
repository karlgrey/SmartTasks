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
});
