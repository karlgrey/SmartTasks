import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('mobile: status tabs, quick-add, status change via panel', async ({ page }) => {
	await page.goto('/');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();

	// single-column mobile board with tabs
	await expect(page.locator('.status-tabs')).toBeVisible();
	await expect(page.locator('[data-column]')).toHaveCount(1);
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();

	// quick-add into the active (Inbox) column
	await page.getByPlaceholder('Add task…').fill('Mobile capture');
	await page.getByPlaceholder('Add task…').press('Enter');
	await expect(page.locator('.card', { hasText: 'Mobile capture' })).toBeVisible();

	// open the sheet, move it to To Do via the Status select
	await page.locator('.card', { hasText: 'Mobile capture' }).click();
	const panelBox = await page.locator('.panel').boundingBox();
	expect(panelBox?.width).toBe(390);
	await page.getByLabel('Status').selectOption('To Do');
	await page.keyboard.press('Escape');

	// switch tab and find it there
	await page.locator('.tab', { hasText: 'To Do' }).click();
	await expect(
		page.locator('[data-column="To Do"] .card', { hasText: 'Mobile capture' })
	).toBeVisible();
});
