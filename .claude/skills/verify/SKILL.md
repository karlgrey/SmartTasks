---
name: verify
description: Build/launch/drive recipe to verify SmartTasks UI changes end-to-end with a throwaway DB and Playwright.
---

# Verifying SmartTasks changes

## Launch with an isolated DB

```bash
npx tsx e2e/seed.ts                                  # recreates .e2e/test.db (rm -rf .e2e first, done by the script)
DATABASE_PATH=.e2e/test.db npm run dev -- --port 5199 # background
curl -s http://localhost:5199/login                   # wait until 200
```

Seed credentials: `micha@e2e.test` / `e2e-password-1` (see `e2e/seed.ts`).
Default DB (do NOT touch): `data/smarttasks.db` via `DATABASE_PATH` env, see `src/lib/server/db/index.ts`.

## Drive with Playwright

Write a plain `.mjs` script that imports `@playwright/test`'s `chromium`. It must live **inside the repo**
(e.g. `.e2e/`, gitignored) so ESM resolves `node_modules`; scripts in the scratchpad fail with ERR_MODULE_NOT_FOUND.
Delete it afterwards.

Login flow (the form is JS-driven; wait for the API response, not just navigation):

```js
await page.goto(BASE + '/login');
await page.fill('input[type="email"]', 'micha@e2e.test');
await page.fill('input[type="password"]', 'e2e-password-1');
await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/auth/login')),
  page.click('button[type="submit"]'),
]);
```

After login, `page.request` shares cookies — create fixtures via the API directly,
e.g. `page.request.post(BASE + '/api/tasks', { data: { title } })` (201 → TaskDTO). Task detail view: `/task/<id>`.

## Gotchas

- The task detail page (`src/routes/(app)/task/[id]/+page.svelte`) has a scoped `textarea { min-height: 90px; ... }`
  rule meant for description/comments — any new textarea on that page inherits it unless overridden.
- `npm run check` = svelte-check; unit tests `npm run test:unit`; e2e `npm run test:e2e` (builds + seeds itself, port 4173).
- **CSRF vs multipart:** SvelteKit rejects multipart/form-data POSTs (e.g. photo upload) when the server's `ORIGIN`
  doesn't match — JSON endpoints are exempt, so "everything else works" proves nothing. The e2e webServer and the
  prod systemd unit both set `ORIGIN`; a dev server (`vite dev`) is unaffected.
- Photo uploads in Playwright: `setInputFiles('.photos input[type="file"]', { name, mimeType, buffer })` — the
  client downscales via canvas (`src/lib/client/image.ts`), works headless. Files land in `<db-dir>/uploads/`.
