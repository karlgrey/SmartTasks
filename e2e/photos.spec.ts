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

// Minimal but structurally valid PDF (%PDF header + %%EOF footer)
const PDF = Buffer.from(
	'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'
);

test('upload PDF (#201) → file icon → download headers → delete', async ({ page }) => {
	await page.goto('/');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();

	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').fill('PDF task');
	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').press('Enter');
	await page.locator('.card', { hasText: 'PDF task' }).click();
	await expect(page).toHaveURL(/\/task\/\d+/);

	await page.locator('.photos input[type="file"]').setInputFiles({
		name: 'report.pdf',
		mimeType: 'application/pdf',
		buffer: PDF
	});

	const fileThumb = page.locator('.photos .thumb.file');
	await expect(fileThumb).toBeVisible();
	await expect(fileThumb.locator('.file-name')).toHaveText('report.pdf');

	// download headers: correct content-type + attachment disposition (not inline)
	const href = await fileThumb.locator('.file-link').getAttribute('href');
	const res = await page.request.get(href!);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toBe('application/pdf');
	expect(res.headers()['content-disposition']).toMatch(/^attachment;.*filename="report\.pdf"/);

	// two-step delete, same pattern as photos
	await fileThumb.locator('.remove').click();
	await fileThumb.locator('.remove', { hasText: 'Del?' }).click();
	await expect(page.locator('.photos .thumb.file')).toHaveCount(0);
});

test('rejects a disallowed file type client → server round trip', async ({ page }) => {
	await page.goto('/');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();

	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').fill('Bad upload task');
	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').press('Enter');
	await page.locator('.card', { hasText: 'Bad upload task' }).click();
	await expect(page).toHaveURL(/\/task\/\d+/);

	// The <input accept> doesn't stop a scripted upload — the server must still
	// reject it (415/400) and no attachment must appear.
	await page.locator('.photos input[type="file"]').setInputFiles({
		name: 'virus.exe',
		mimeType: 'application/octet-stream',
		buffer: Buffer.from('MZ fake exe')
	});
	await expect(page.locator('.toast').first()).toBeVisible();
	await expect(page.locator('.photos .thumb')).toHaveCount(0);
});
