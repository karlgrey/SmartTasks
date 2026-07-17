import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	// All specs share ONE server + ONE seeded SQLite DB, and the board broadcasts
	// task changes over SSE to every open context. Running specs in parallel lets
	// those contexts cross-pollinate (a task created in one test appears on
	// another's board while its own quick-add races), which is non-deterministic
	// — it happened to pass at ≤3 workers but breaks as the suite grows. Serial
	// execution keeps the shared fixture deterministic; the suite is tiny.
	workers: 1,
	use: { baseURL: 'http://localhost:4173' },
	webServer: {
		command:
			// ORIGIN: SvelteKit's CSRF check rejects multipart form POSTs (photo upload) without it
			'npm run build && npx tsx e2e/seed.ts && DATABASE_PATH=.e2e/test.db PORT=4173 ORIGIN=http://localhost:4173 node build',
		url: 'http://localhost:4173',
		reuseExistingServer: false,
		timeout: 180_000
	}
});
