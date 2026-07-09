import { test, expect } from '@playwright/test';

// 1x1 red PNG
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

test('upload photo → thumbnail → full view → delete', async ({ page }) => {
	await page.goto('/');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();

	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').fill('Photo task');
	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').press('Enter');
	await page.locator('.card', { hasText: 'Photo task' }).click();
	await expect(page).toHaveURL(/\/task\/\d+/);

	await page.locator('.photos input[type="file"]').setInputFiles({
		name: 'site.png',
		mimeType: 'image/png',
		buffer: PNG
	});
	const thumb = page.locator('.photos .thumb img');
	await expect(thumb).toBeVisible();

	// full image serves with 200 + image content type
	const src = await thumb.getAttribute('src');
	const res = await page.request.get(src!);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toMatch(/^image\//);

	// two-step delete
	await page.locator('.photos .remove').click();
	await page.locator('.photos .remove', { hasText: 'Del?' }).click();
	await expect(page.locator('.photos .thumb')).toHaveCount(0);
});
