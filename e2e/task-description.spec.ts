import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
	await page.goto('/');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();
}

test('empty description: click-to-edit still works unchanged', async ({ page }) => {
	await login(page);

	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').fill('Empty desc task');
	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').press('Enter');
	await page.locator('.card', { hasText: 'Empty desc task' }).click();
	await expect(page).toHaveURL(/\/task\/\d+/);

	// no edit button while empty
	await expect(page.locator('.description button', { hasText: 'Edit' })).toHaveCount(0);

	// clicking the hint starts edit mode directly (unchanged behavior)
	await page.locator('.description .rendered').click();
	await expect(page.locator('.description textarea')).toBeVisible();
	await page.locator('.description textarea').fill('Filled in now');
	await page.locator('.description textarea').blur();
	await expect(page.locator('.description .rendered')).toContainText('Filled in now');
});

test('description with content: edit only via button, text stays selectable', async ({ page }) => {
	await login(page);

	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').fill('Filled desc task');
	await page.locator('[data-column="Inbox"]').getByPlaceholder('Add task…').press('Enter');
	await page.locator('.card', { hasText: 'Filled desc task' }).click();
	await expect(page).toHaveURL(/\/task\/\d+/);

	// seed a description via the click-to-edit path first
	await page.locator('.description .rendered').click();
	await page.locator('.description textarea').fill('Some existing text');
	await page.locator('.description textarea').blur();
	await expect(page.locator('.description .rendered')).toContainText('Some existing text');

	// now a dedicated edit button must be visible
	const editButton = page.locator('.description button', { hasText: 'Edit' });
	await expect(editButton).toBeVisible();

	// clicking the rendered text must NOT enter edit mode anymore
	await page.locator('.description .rendered').click();
	await expect(page.locator('.description textarea')).toHaveCount(0);
	await expect(page.locator('.description .rendered')).toContainText('Some existing text');

	// only the button starts editing
	await editButton.click();
	const textarea = page.locator('.description textarea');
	await expect(textarea).toBeVisible();
	await expect(textarea).toHaveValue('Some existing text');

	// edit textarea is twice the previous min-height (90px → 180px)
	const minHeight = await textarea.evaluate((el) => getComputedStyle(el).minHeight);
	expect(minHeight).toBe('180px');

	await textarea.fill('Updated text');
	await textarea.blur();
	await expect(page.locator('.description .rendered')).toContainText('Updated text');
});
