import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
	await page.goto('/');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="Inbox"]')).toBeVisible();
}

test('create doc → renders as HTML → link a task both directions', async ({ page }) => {
	await login(page);

	// a task to link later
	await page.locator('[data-column="To Do"]').getByPlaceholder('Add task…').fill('Doc link task');
	await page.locator('[data-column="To Do"]').getByPlaceholder('Add task…').press('Enter');
	await expect(page.locator('.card', { hasText: 'Doc link task' })).toBeVisible();

	// go to docs and create one
	await page.getByRole('link', { name: 'Docs' }).first().click();
	await expect(page).toHaveURL(/\/docs$/);
	await page.getByRole('link', { name: '+ New document' }).click();
	await expect(page).toHaveURL(/\/docs\/new$/);

	await page.getByPlaceholder('Title').fill('My SOP');
	await page.getByPlaceholder('Write Markdown…').fill('# Heading\n\nsome **bold** text');
	await page.getByRole('button', { name: 'Create' }).click();

	// rendered doc page: markdown became HTML (bold + heading in the body)
	await expect(page).toHaveURL(/\/docs\/\d+$/);
	await expect(page.getByRole('heading', { name: 'My SOP', level: 1 })).toBeVisible();
	await expect(page.locator('.body strong', { hasText: 'bold' })).toBeVisible();
	await expect(page.locator('.body h1', { hasText: 'Heading' })).toBeVisible();

	// link the task via the picker (option index 1 = the only linkable task)
	const picker = page.locator('.links select');
	await picker.focus();
	await expect(page.locator('.links select option', { hasText: 'Doc link task' })).toBeAttached();
	await picker.selectOption({ index: 1 });
	const linkedRow = page.locator('.links li', { hasText: 'Doc link task' });
	await expect(linkedRow).toBeVisible();

	// reciprocal: open the task, the doc shows up under its Docs section
	await linkedRow.getByRole('link', { name: /Doc link task/ }).click();
	await expect(page).toHaveURL(/\/task\/\d+/);
	await expect(page.locator('.docs').getByRole('link', { name: 'My SOP' })).toBeVisible();
});
