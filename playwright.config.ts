import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
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
