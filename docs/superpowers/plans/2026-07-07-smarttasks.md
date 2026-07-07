# SmartTasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lean, fast kanban task manager (web UI + REST API) shared by humans and AI agents, replacing the Notion Tasks database.

**Architecture:** One SvelteKit app serves both the web UI and the REST API from a single Node process. SQLite (Drizzle ORM, WAL mode) is the only datastore. Business logic lives in plain server modules (`src/lib/server/*`) that take the db as first argument — endpoints are thin wrappers, tests hit the services with an in-memory SQLite.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript, better-sqlite3 + drizzle-orm, bcryptjs, Vitest, Playwright, adapter-node, Docker + Fly.io + Litestream.

**Spec:** `docs/superpowers/specs/2026-07-07-smarttasks-design.md`

## Global Constraints

- Node 22+, npm. SvelteKit 2 with Svelte 5 runes syntax (`$state`, `$derived`, `$props`, `onclick=`).
- SQLite file at `process.env.DATABASE_PATH ?? 'data/smarttasks.db'`, WAL mode, foreign keys ON. Tests use `':memory:'`.
- Statuses, verbatim: `Inbox`, `To Do`, `Icebox`, `In Progress`, `Supplier`, `Review`, `Done`.
- Priorities, verbatim: `Super-High`, `High`, `Medium`, `Low`. Sizes: `S`, `M`, `L`.
- Business rule: users with `type === 'ai'` may never set status `Done` → HTTP 403, message exactly `AI users cannot set status to Done`.
- `completed_at` is stamped when status changes to `Done`, cleared when it changes away from `Done`.
- Board sort order (server and client): priority (Super-High→Low, none last) → due date (none last) → created_at ascending.
- All API errors: JSON body `{ "error": "<message>" }` with correct HTTP status code.
- Web UI copy in English.
- TDD for all server logic: failing test first. Commit at the end of every task.

## File Structure

```
src/
  lib/
    types.ts                       # shared enums + DTO types (client & server)
    server/
      errors.ts                    # ServiceError
      db/schema.ts                 # Drizzle tables
      db/index.ts                  # createDb() + singleton
      auth.ts                      # passwords, api keys, sessions, users
      tasks-service.ts             # list/create/get/update + filters + rules
      comments-service.ts          # addComment
      projects-service.ts          # projects + user listing
      events.ts                    # in-memory SSE broadcaster
      api-utils.ts                 # requireUser(), run()
      api-docs.ts                  # markdown served at /api/docs
      test-utils.ts                # testDb(), seedUsers()
    client/
      api.ts                       # fetch wrapper
      board.svelte.ts              # reactive board state, optimistic updates, SSE
      markdown.ts                  # marked + dompurify helper
    components/
      Board.svelte  Column.svelte  TaskCard.svelte
      FilterBar.svelte  QuickAdd.svelte  Toasts.svelte
  hooks.server.ts                  # locals.user from cookie or bearer key
  app.d.ts  app.css
  routes/
    +layout.svelte                 # global css shell
    login/+page.svelte  login/+page.server.ts
    (app)/+layout.server.ts        # auth guard + initial board data
    (app)/+layout.svelte           # FilterBar + Board + Toasts + children
    (app)/+page.svelte             # empty (board lives in layout)
    (app)/task/[id]/+page.svelte   # slide-over task panel
    api/auth/login/+server.ts  api/auth/logout/+server.ts
    api/tasks/+server.ts  api/tasks/[id]/+server.ts
    api/tasks/[id]/comments/+server.ts
    api/projects/+server.ts  api/projects/[id]/+server.ts
    api/users/+server.ts  api/events/+server.ts  api/docs/+server.ts
scripts/seed.ts  scripts/create-api-key.ts
e2e/seed.ts  e2e/board.spec.ts  playwright.config.ts
drizzle.config.ts  Dockerfile  docker-entrypoint.sh  fly.toml  litestream.yml
```

---

### Task 1: Scaffold SvelteKit project

**Files:**
- Create: SvelteKit scaffold in repo root, `svelte.config.js`, `vite.config.ts`, `src/lib/types.ts`
- Modify: `.gitignore`, `package.json`

**Interfaces:**
- Produces: `STATUSES`, `PRIORITIES`, `SIZES` const tuples and `Status`, `Priority`, `Size`, `TaskDTO`, `CommentDTO`, `UserDTO`, `ProjectDTO` types from `$lib/types` — every later task uses these exact names.

- [ ] **Step 1: Scaffold**

Run in the repo root (dir contains only `docs/` and `.git/` — confirm "continue" when asked about the non-empty directory):

```bash
npx sv create . --template minimal --types ts --no-add-ons --install npm
```

- [ ] **Step 2: Install dependencies**

```bash
npm i drizzle-orm better-sqlite3 bcryptjs marked dompurify
npm i -D drizzle-kit @types/better-sqlite3 vitest @playwright/test tsx @sveltejs/adapter-node
```

- [ ] **Step 3: Configure adapter-node and Vitest**

Replace `svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: { adapter: adapter() }
};

export default config;
```

Replace `vite.config.ts`:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
```

Add to `package.json` scripts:

```json
"test:unit": "vitest run",
"test:e2e": "playwright test",
"seed": "tsx scripts/seed.ts"
```

Append to `.gitignore`:

```
data/
.e2e/
```

- [ ] **Step 4: Create shared types**

Create `src/lib/types.ts`:

```ts
export const STATUSES = [
	'Inbox', 'To Do', 'Icebox', 'In Progress', 'Supplier', 'Review', 'Done'
] as const;
export const PRIORITIES = ['Super-High', 'High', 'Medium', 'Low'] as const;
export const SIZES = ['S', 'M', 'L'] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Size = (typeof SIZES)[number];

export type UserDTO = {
	id: number;
	name: string;
	email: string | null;
	type: 'human' | 'ai';
	color: string;
};

export type ProjectDTO = {
	id: number;
	name: string;
	color: string;
	archived: boolean;
};

export type TaskDTO = {
	id: number;
	title: string;
	description: string;
	status: Status;
	priority: Priority | null;
	size: Size | null;
	hours: number | null;
	dueDate: string | null; // ISO date (YYYY-MM-DD)
	assigneeId: number | null;
	projectId: number | null;
	createdBy: number;
	createdAt: string; // ISO datetime
	updatedAt: string;
	completedAt: string | null;
};

export type CommentDTO = {
	id: number;
	taskId: number;
	authorId: number;
	body: string;
	createdAt: string;
};
```

- [ ] **Step 5: Verify toolchain**

```bash
npm run check && npm run test:unit
```

Expected: `svelte-check` passes; Vitest exits with "no test files found" (acceptable — pass `--passWithNoTests` if it errors: change script to `vitest run --passWithNoTests`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold SvelteKit project with adapter-node, vitest, shared types"
```

---

### Task 2: Database schema + connection

**Files:**
- Create: `src/lib/server/db/schema.ts`, `src/lib/server/db/index.ts`, `drizzle.config.ts`, `drizzle/` (generated), `src/lib/server/db/db.test.ts`

**Interfaces:**
- Consumes: `STATUSES`, `PRIORITIES`, `SIZES` from `$lib/types`.
- Produces: tables `users`, `sessions`, `projects`, `tasks`, `comments`; `createDb(path: string): Db`; `db` singleton; `type Db`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/db/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDb } from './index';
import { tasks, users } from './schema';

describe('db', () => {
	it('creates schema and round-trips a task', () => {
		const db = createDb(':memory:');
		const user = db
			.insert(users)
			.values({ name: 'Micha', email: 'm@test.dev', type: 'human' })
			.returning()
			.get();
		const now = new Date().toISOString();
		const task = db
			.insert(tasks)
			.values({ title: 'First task', createdBy: user.id, createdAt: now, updatedAt: now })
			.returning()
			.get();
		expect(task.id).toBe(1);
		expect(task.status).toBe('Inbox');
		expect(task.description).toBe('');
		expect(task.completedAt).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/db/db.test.ts`
Expected: FAIL — cannot resolve `./index` / `./schema`.

- [ ] **Step 3: Write schema**

Create `src/lib/server/db/schema.ts`:

```ts
import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';
// Relative import (not $lib) on purpose: schema.ts is also loaded by drizzle-kit
// and the plain-tsx scripts in scripts/, which don't know SvelteKit aliases.
import { STATUSES, PRIORITIES, SIZES } from '../../types';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	email: text('email').unique(),
	type: text('type', { enum: ['human', 'ai'] }).notNull(),
	passwordHash: text('password_hash'),
	apiKeyHash: text('api_key_hash'),
	color: text('color').notNull().default('#6b7280')
});

export const sessions = sqliteTable('sessions', {
	token: text('token').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export const projects = sqliteTable('projects', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	color: text('color').notNull().default('#6b7280'),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
});

export const tasks = sqliteTable('tasks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	status: text('status', { enum: STATUSES }).notNull().default('Inbox'),
	priority: text('priority', { enum: PRIORITIES }),
	size: text('size', { enum: SIZES }),
	hours: real('hours'),
	dueDate: text('due_date'),
	assigneeId: integer('assignee_id').references(() => users.id),
	projectId: integer('project_id').references(() => projects.id),
	createdBy: integer('created_by')
		.notNull()
		.references(() => users.id),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	completedAt: text('completed_at')
});

export const comments = sqliteTable('comments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	taskId: integer('task_id')
		.notNull()
		.references(() => tasks.id),
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id),
	body: text('body').notNull(),
	createdAt: text('created_at').notNull()
});
```

Create `drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: 'data/smarttasks.db' }
});
```

Generate the migration:

```bash
npx drizzle-kit generate
```

Expected: SQL migration file appears under `drizzle/`.

Create `src/lib/server/db/index.ts`:

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

export function createDb(path: string) {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'drizzle' });
	return db;
}

export type Db = ReturnType<typeof createDb>;

export const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/db/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add sqlite schema, migrations, and db connection"
```

---

### Task 3: Auth core (passwords, API keys, sessions, users)

**Files:**
- Create: `src/lib/server/errors.ts`, `src/lib/server/auth.ts`, `src/lib/server/test-utils.ts`, `src/lib/server/auth.test.ts`

**Interfaces:**
- Consumes: `createDb`, `Db`, tables from Task 2; `UserDTO` from `$lib/types`.
- Produces:
  - `class ServiceError extends Error { status: number }` from `$lib/server/errors`
  - `type SafeUser = UserDTO`
  - `createUser(db, { name, email?, type, password?, color? }): SafeUser`
  - `setApiKey(db, userId: number): string` (returns the plaintext key once)
  - `loginWithPassword(db, email, password): { user: SafeUser; token: string } | null`
  - `deleteSession(db, token: string): void`
  - `resolveUser(db, { bearer?: string | null; sessionToken?: string | null }): SafeUser | null`
  - `testDb(): Db` and `seedUsers(db): { micha: SafeUser; claude: SafeUser }` from `$lib/server/test-utils`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createUser, setApiKey, loginWithPassword, resolveUser, deleteSession } from './auth';
import { sessions } from './db/schema';
import { testDb } from './test-utils';

describe('auth', () => {
	it('logs in with correct password only', () => {
		const db = testDb();
		createUser(db, { name: 'Micha', email: 'm@test.dev', type: 'human', password: 'secret1' });
		expect(loginWithPassword(db, 'm@test.dev', 'wrong')).toBeNull();
		expect(loginWithPassword(db, 'nobody@test.dev', 'secret1')).toBeNull();
		const result = loginWithPassword(db, 'M@TEST.DEV', 'secret1');
		expect(result?.user.name).toBe('Micha');
		expect(result?.token).toHaveLength(64);
	});

	it('resolves a user from a session token, until logout or expiry', () => {
		const db = testDb();
		createUser(db, { name: 'Micha', email: 'm@test.dev', type: 'human', password: 'secret1' });
		const { token, user } = loginWithPassword(db, 'm@test.dev', 'secret1')!;
		expect(resolveUser(db, { sessionToken: token })?.id).toBe(user.id);
		// expired session
		db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.token, token)).run();
		expect(resolveUser(db, { sessionToken: token })).toBeNull();
		deleteSession(db, token);
		expect(resolveUser(db, { sessionToken: token })).toBeNull();
	});

	it('resolves an AI user from a bearer api key', () => {
		const db = testDb();
		const claude = createUser(db, { name: 'Claude', type: 'ai' });
		const key = setApiKey(db, claude.id);
		expect(key).toMatch(/^st_/);
		const resolved = resolveUser(db, { bearer: `Bearer ${key}` });
		expect(resolved?.name).toBe('Claude');
		expect(resolved?.type).toBe('ai');
		expect(resolveUser(db, { bearer: 'Bearer st_wrong' })).toBeNull();
	});

	it('never exposes hashes on SafeUser', () => {
		const db = testDb();
		const u = createUser(db, { name: 'X', email: 'x@test.dev', type: 'human', password: 'p' });
		expect(u).not.toHaveProperty('passwordHash');
		expect(u).not.toHaveProperty('apiKeyHash');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/auth.test.ts`
Expected: FAIL — cannot resolve `./auth` / `./test-utils`.

- [ ] **Step 3: Implement**

Create `src/lib/server/errors.ts`:

```ts
export class ServiceError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}
```

Create `src/lib/server/auth.ts`:

```ts
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { users, sessions } from './db/schema';
import type { UserDTO } from '$lib/types';

export type SafeUser = UserDTO;

type UserRow = typeof users.$inferSelect;

export function toSafeUser(u: UserRow): SafeUser {
	return { id: u.id, name: u.name, email: u.email, type: u.type, color: u.color };
}

export function createUser(
	db: Db,
	input: { name: string; email?: string; type: 'human' | 'ai'; password?: string; color?: string }
): SafeUser {
	return toSafeUser(
		db
			.insert(users)
			.values({
				name: input.name,
				email: input.email ?? null,
				type: input.type,
				passwordHash: input.password ? bcrypt.hashSync(input.password, 10) : null,
				color: input.color ?? '#6b7280'
			})
			.returning()
			.get()
	);
}

export function hashApiKey(key: string): string {
	return createHash('sha256').update(key).digest('hex');
}

export function setApiKey(db: Db, userId: number): string {
	const key = 'st_' + randomBytes(24).toString('hex');
	db.update(users).set({ apiKeyHash: hashApiKey(key) }).where(eq(users.id, userId)).run();
	return key;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function loginWithPassword(
	db: Db,
	email: string,
	password: string
): { user: SafeUser; token: string } | null {
	const u = db
		.select()
		.from(users)
		.where(sql`lower(${users.email}) = lower(${email})`)
		.get();
	if (!u?.passwordHash || !bcrypt.compareSync(password, u.passwordHash)) return null;
	const token = randomBytes(32).toString('hex');
	db.insert(sessions)
		.values({ token, userId: u.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
		.run();
	return { user: toSafeUser(u), token };
}

export function deleteSession(db: Db, token: string): void {
	db.delete(sessions).where(eq(sessions.token, token)).run();
}

export function resolveUser(
	db: Db,
	opts: { bearer?: string | null; sessionToken?: string | null }
): SafeUser | null {
	if (opts.bearer?.startsWith('Bearer ')) {
		const hash = hashApiKey(opts.bearer.slice(7).trim());
		const u = db.select().from(users).where(eq(users.apiKeyHash, hash)).get();
		return u ? toSafeUser(u) : null;
	}
	if (opts.sessionToken) {
		const row = db
			.select({ session: sessions, user: users })
			.from(sessions)
			.innerJoin(users, eq(users.id, sessions.userId))
			.where(eq(sessions.token, opts.sessionToken))
			.get();
		if (!row || row.session.expiresAt.getTime() < Date.now()) return null;
		return toSafeUser(row.user);
	}
	return null;
}
```

Create `src/lib/server/test-utils.ts`:

```ts
import { createDb, type Db } from './db';
import { createUser, type SafeUser } from './auth';

export function testDb(): Db {
	return createDb(':memory:');
}

export function seedUsers(db: Db): { micha: SafeUser; claude: SafeUser } {
	return {
		micha: createUser(db, { name: 'Micha', email: 'micha@test.dev', type: 'human', password: 'pw12345' }),
		claude: createUser(db, { name: 'Claude', type: 'ai' })
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: auth core — passwords, api keys, sessions, safe users"
```

---

### Task 4: Request auth — hooks + login/logout endpoints

**Files:**
- Create: `src/hooks.server.ts`, `src/routes/api/auth/login/+server.ts`, `src/routes/api/auth/logout/+server.ts`, `src/lib/server/api-utils.ts`, `src/lib/server/api-utils.test.ts`
- Modify: `src/app.d.ts`

**Interfaces:**
- Consumes: `resolveUser`, `loginWithPassword`, `deleteSession`, `SafeUser` (Task 3); `db` singleton (Task 2).
- Produces: `event.locals.user: SafeUser | null` on every request; `requireUser(locals): SafeUser` (throws `ServiceError(401)`), `run(fn): Promise<Response>` (maps `ServiceError` → JSON error response) from `$lib/server/api-utils`; session cookie name `session`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/api-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { json } from '@sveltejs/kit';
import { requireUser, run } from './api-utils';
import { ServiceError } from './errors';

describe('api-utils', () => {
	it('requireUser throws 401 without a user and returns the user otherwise', () => {
		expect(() => requireUser({ user: null })).toThrowError(ServiceError);
		const user = { id: 1, name: 'M', email: null, type: 'human' as const, color: '#fff' };
		expect(requireUser({ user })).toBe(user);
	});

	it('run maps ServiceError to a JSON error response', async () => {
		const res = await run(() => {
			throw new ServiceError(403, 'AI users cannot set status to Done');
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'AI users cannot set status to Done' });
	});

	it('run passes successful responses through', async () => {
		const res = await run(() => json({ ok: true }));
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/api-utils.test.ts`
Expected: FAIL — cannot resolve `./api-utils`.

- [ ] **Step 3: Implement**

Create `src/lib/server/api-utils.ts`:

```ts
import { json } from '@sveltejs/kit';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';

export function requireUser(locals: { user: SafeUser | null }): SafeUser {
	if (!locals.user) throw new ServiceError(401, 'authentication required');
	return locals.user;
}

export async function run(fn: () => Response | Promise<Response>): Promise<Response> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof ServiceError) return json({ error: e.message }, { status: e.status });
		throw e;
	}
}
```

Replace the `App` namespace in `src/app.d.ts`:

```ts
import type { SafeUser } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			user: SafeUser | null;
		}
	}
}

export {};
```

Create `src/hooks.server.ts`:

```ts
import type { Handle } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { resolveUser } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = resolveUser(db, {
		bearer: event.request.headers.get('authorization'),
		sessionToken: event.cookies.get('session')
	});
	return resolve(event);
};
```

Create `src/routes/api/auth/login/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { db } from '$lib/server/db';
import { loginWithPassword } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const { email, password } = await request.json().catch(() => ({}));
	const result = email && password ? loginWithPassword(db, email, password) : null;
	if (!result) return json({ error: 'invalid credentials' }, { status: 401 });
	cookies.set('session', result.token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 30 * 24 * 60 * 60
	});
	return json(result.user);
};
```

Create `src/routes/api/auth/logout/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { deleteSession } from '$lib/server/auth';

export const POST: RequestHandler = ({ cookies }) => {
	const token = cookies.get('session');
	if (token) deleteSession(db, token);
	cookies.delete('session', { path: '/' });
	return json({ ok: true });
};
```

- [ ] **Step 4: Run tests and check**

Run: `npx vitest run && npm run check`
Expected: all tests PASS, svelte-check clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: request auth via session cookie or bearer key, login/logout endpoints"
```

---

### Task 5: Tasks service — list with filters + create

**Files:**
- Create: `src/lib/server/tasks-service.ts`, `src/lib/server/tasks-service.test.ts`

**Interfaces:**
- Consumes: `Db`, `tasks`, `users` tables (Task 2); `SafeUser` (Task 3); `ServiceError`; enums from `$lib/types`.
- Produces:
  - `type TaskFilters = { assignee?: string; project?: number; status?: Status; open?: boolean; q?: string; limit?: number; offset?: number }`
  - `type TaskInput = { title: string; description?: string; status?: Status; priority?: Priority | null; size?: Size | null; hours?: number | null; dueDate?: string | null; assigneeId?: number | null; projectId?: number | null }`
  - `listTasks(db, filters?: TaskFilters): TaskDTO[]` (sorted: priority → dueDate → createdAt)
  - `createTask(db, user: SafeUser, input: TaskInput): TaskDTO`
  - `parseTaskFilters(params: URLSearchParams): TaskFilters`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/tasks-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listTasks, createTask, parseTaskFilters } from './tasks-service';
import { testDb, seedUsers } from './test-utils';

describe('createTask', () => {
	it('creates with defaults and rejects empty titles and bad enums', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: '  Buy wood  ' });
		expect(t.title).toBe('Buy wood');
		expect(t.status).toBe('Inbox');
		expect(t.createdBy).toBe(micha.id);
		expect(() => createTask(db, micha, { title: '   ' })).toThrowError('title is required');
		// @ts-expect-error invalid enum on purpose
		expect(() => createTask(db, micha, { title: 'x', status: 'Doing' })).toThrowError();
	});
});

describe('listTasks', () => {
	function seed(db: ReturnType<typeof testDb>) {
		const { micha, claude } = seedUsers(db);
		createTask(db, micha, { title: 'Low prio', priority: 'Low', assigneeId: micha.id });
		createTask(db, micha, { title: 'Urgent', priority: 'Super-High', assigneeId: claude.id });
		createTask(db, micha, { title: 'No prio, has due', dueDate: '2026-01-01' });
		createTask(db, micha, { title: 'Done already', status: 'Done' });
		return { micha, claude };
	}

	it('sorts by priority, then due date, then age', () => {
		const db = testDb();
		seed(db);
		expect(listTasks(db).map((t) => t.title)).toEqual([
			'Urgent', 'Low prio', 'No prio, has due', 'Done already'
		]);
	});

	it('filters by open, assignee (id or name, case-insensitive), q, status, limit', () => {
		const db = testDb();
		const { claude } = seed(db);
		expect(listTasks(db, { open: true }).map((t) => t.title)).not.toContain('Done already');
		expect(listTasks(db, { assignee: String(claude.id) })[0].title).toBe('Urgent');
		expect(listTasks(db, { assignee: 'claude' })[0].title).toBe('Urgent');
		expect(listTasks(db, { assignee: 'nobody' })).toEqual([]);
		expect(listTasks(db, { q: 'urg' }).map((t) => t.title)).toEqual(['Urgent']);
		expect(listTasks(db, { status: 'Done' }).map((t) => t.title)).toEqual(['Done already']);
		expect(listTasks(db, { limit: 2 })).toHaveLength(2);
	});
});

describe('parseTaskFilters', () => {
	it('parses url params', () => {
		const f = parseTaskFilters(
			new URLSearchParams('assignee=claude&project=3&open=true&q=wood&limit=50&offset=10')
		);
		expect(f).toEqual({ assignee: 'claude', project: 3, open: true, q: 'wood', limit: 50, offset: 10 });
		expect(parseTaskFilters(new URLSearchParams(''))).toEqual({});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/tasks-service.test.ts`
Expected: FAIL — cannot resolve `./tasks-service`.

- [ ] **Step 3: Implement**

Create `src/lib/server/tasks-service.ts`:

```ts
import { and, eq, ne, or, like, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, users } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import { STATUSES, PRIORITIES, SIZES, type Status, type Priority, type Size, type TaskDTO } from '$lib/types';

export type TaskFilters = {
	assignee?: string;
	project?: number;
	status?: Status;
	open?: boolean;
	q?: string;
	limit?: number;
	offset?: number;
};

export type TaskInput = {
	title: string;
	description?: string;
	status?: Status;
	priority?: Priority | null;
	size?: Size | null;
	hours?: number | null;
	dueDate?: string | null;
	assigneeId?: number | null;
	projectId?: number | null;
};

export function assertEnum<T extends string>(
	field: string,
	value: unknown,
	allowed: readonly T[]
): void {
	if (value !== null && value !== undefined && !allowed.includes(value as T))
		throw new ServiceError(400, `invalid ${field}: must be one of ${allowed.join(', ')}`);
}

function validateEnums(input: Partial<TaskInput>): void {
	assertEnum('status', input.status, STATUSES);
	assertEnum('priority', input.priority, PRIORITIES);
	assertEnum('size', input.size, SIZES);
}

const boardOrder = [
	sql`CASE ${tasks.priority} WHEN 'Super-High' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END`,
	sql`${tasks.dueDate} IS NULL`,
	tasks.dueDate,
	tasks.createdAt
];

export function listTasks(db: Db, filters: TaskFilters = {}): TaskDTO[] {
	const conds: SQL[] = [];
	if (filters.assignee !== undefined) {
		if (/^\d+$/.test(filters.assignee)) {
			conds.push(eq(tasks.assigneeId, Number(filters.assignee)));
		} else {
			const user = db
				.select()
				.from(users)
				.where(sql`lower(${users.name}) = lower(${filters.assignee})`)
				.get();
			if (!user) return [];
			conds.push(eq(tasks.assigneeId, user.id));
		}
	}
	if (filters.project !== undefined) conds.push(eq(tasks.projectId, filters.project));
	if (filters.status) conds.push(eq(tasks.status, filters.status));
	if (filters.open) conds.push(ne(tasks.status, 'Done'));
	if (filters.q) {
		const pattern = `%${filters.q}%`;
		conds.push(or(like(tasks.title, pattern), like(tasks.description, pattern))!);
	}
	return db
		.select()
		.from(tasks)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(...boardOrder)
		.limit(filters.limit ?? -1)
		.offset(filters.offset ?? 0)
		.all();
}

export function createTask(db: Db, user: SafeUser, input: TaskInput): TaskDTO {
	if (!input.title?.trim()) throw new ServiceError(400, 'title is required');
	validateEnums(input);
	const now = new Date().toISOString();
	return db
		.insert(tasks)
		.values({
			title: input.title.trim(),
			description: input.description ?? '',
			status: input.status ?? 'Inbox',
			priority: input.priority ?? null,
			size: input.size ?? null,
			hours: input.hours ?? null,
			dueDate: input.dueDate ?? null,
			assigneeId: input.assigneeId ?? null,
			projectId: input.projectId ?? null,
			createdBy: user.id,
			createdAt: now,
			updatedAt: now
		})
		.returning()
		.get();
}

export function parseTaskFilters(params: URLSearchParams): TaskFilters {
	const f: TaskFilters = {};
	const assignee = params.get('assignee');
	if (assignee) f.assignee = assignee;
	const project = params.get('project');
	if (project) f.project = Number(project);
	const status = params.get('status');
	if (status) f.status = status as Status;
	if (params.get('open') === 'true') f.open = true;
	const q = params.get('q');
	if (q) f.q = q;
	const limit = params.get('limit');
	if (limit) f.limit = Number(limit);
	const offset = params.get('offset');
	if (offset) f.offset = Number(offset);
	return f;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/tasks-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tasks service — filtered, board-sorted listing and creation"
```

---

### Task 6: Tasks service — get + update with business rules

**Files:**
- Modify: `src/lib/server/tasks-service.ts`, `src/lib/server/tasks-service.test.ts`

**Interfaces:**
- Consumes: everything from Task 5; `comments` table (Task 2).
- Produces:
  - `getTask(db, id: number): TaskDTO & { comments: CommentDTO[] }` (throws `ServiceError(404, 'task not found')`)
  - `updateTask(db, user: SafeUser, id: number, patch: Partial<TaskInput>): TaskDTO`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/server/tasks-service.test.ts` (add `getTask, updateTask` to the existing import from `./tasks-service`):

```ts
describe('getTask', () => {
	it('returns task with comments, 404 otherwise', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'With comments' });
		expect(getTask(db, t.id)).toEqual({ ...t, comments: [] });
		expect(() => getTask(db, 999)).toThrowError('task not found');
	});
});

describe('updateTask', () => {
	it('updates fields and bumps updatedAt', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Old' });
		const updated = updateTask(db, micha, t.id, { title: 'New', priority: 'High', hours: 2.5 });
		expect(updated.title).toBe('New');
		expect(updated.priority).toBe('High');
		expect(updated.hours).toBe(2.5);
		expect(updated.updatedAt >= t.updatedAt).toBe(true);
	});

	it('forbids AI users from setting Done', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const t = createTask(db, micha, { title: 'AI task', assigneeId: claude.id });
		expect(() => updateTask(db, claude, t.id, { status: 'Done' })).toThrowError(
			'AI users cannot set status to Done'
		);
		expect(updateTask(db, claude, t.id, { status: 'Review' }).status).toBe('Review');
		expect(updateTask(db, micha, t.id, { status: 'Done' }).status).toBe('Done');
	});

	it('stamps and clears completedAt on Done transitions', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Finish me' });
		const done = updateTask(db, micha, t.id, { status: 'Done' });
		expect(done.completedAt).not.toBeNull();
		const reopened = updateTask(db, micha, t.id, { status: 'To Do' });
		expect(reopened.completedAt).toBeNull();
	});

	it('ignores non-updatable fields and 404s on missing tasks', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Locked fields' });
		const updated = updateTask(db, micha, t.id, {
			title: 'Ok',
			// @ts-expect-error createdBy must be ignored
			createdBy: 999
		});
		expect(updated.createdBy).toBe(micha.id);
		expect(() => updateTask(db, micha, 999, { title: 'x' })).toThrowError('task not found');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/tasks-service.test.ts`
Expected: FAIL — `getTask` / `updateTask` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/server/tasks-service.ts` (extend the schema import with `comments`, the drizzle import with `asc`, and the types import with `CommentDTO`):

```ts
import { asc } from 'drizzle-orm';
import { comments } from './db/schema';
import type { CommentDTO } from '$lib/types';

export function getTask(db: Db, id: number): TaskDTO & { comments: CommentDTO[] } {
	const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
	if (!task) throw new ServiceError(404, 'task not found');
	const taskComments = db
		.select()
		.from(comments)
		.where(eq(comments.taskId, id))
		.orderBy(asc(comments.createdAt))
		.all();
	return { ...task, comments: taskComments };
}

const UPDATABLE = [
	'title', 'description', 'status', 'priority', 'size', 'hours',
	'dueDate', 'assigneeId', 'projectId'
] as const;

export function updateTask(
	db: Db,
	user: SafeUser,
	id: number,
	patch: Partial<TaskInput>
): TaskDTO {
	const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
	if (!existing) throw new ServiceError(404, 'task not found');
	validateEnums(patch);
	if (patch.status === 'Done' && user.type === 'ai')
		throw new ServiceError(403, 'AI users cannot set status to Done');
	if (patch.title !== undefined && !patch.title.trim())
		throw new ServiceError(400, 'title is required');

	const next: Record<string, unknown> = { updatedAt: new Date().toISOString() };
	for (const key of UPDATABLE) {
		if (key in patch) next[key] = patch[key];
	}
	if (patch.status && patch.status !== existing.status) {
		next.completedAt = patch.status === 'Done' ? new Date().toISOString() : null;
	}
	return db.update(tasks).set(next).where(eq(tasks.id, id)).returning().get();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/tasks-service.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: task detail and updates with AI-cannot-Done rule and completedAt stamping"
```

---

### Task 7: Comments, projects, and users services

**Files:**
- Create: `src/lib/server/comments-service.ts`, `src/lib/server/projects-service.ts`, `src/lib/server/comments-service.test.ts`, `src/lib/server/projects-service.test.ts`

**Interfaces:**
- Consumes: `Db`, tables (Task 2); `SafeUser`, `toSafeUser` (Task 3); `ServiceError`; `getTask` (Task 6).
- Produces:
  - `addComment(db, user: SafeUser, taskId: number, body: string): { comment: CommentDTO; task: TaskDTO }` (also bumps the task's `updatedAt`; 404 on missing task, 400 on empty body)
  - `listProjects(db): ProjectDTO[]`, `createProject(db, input: { name: string; color?: string }): ProjectDTO`, `updateProject(db, id: number, patch: { name?: string; color?: string; archived?: boolean }): ProjectDTO`
  - `listUsers(db): SafeUser[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/comments-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addComment } from './comments-service';
import { createTask, getTask } from './tasks-service';
import { testDb, seedUsers } from './test-utils';

describe('addComment', () => {
	it('adds a comment, bumps the task updatedAt, and returns both', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Discuss' });
		const { comment, task } = addComment(db, claude, t.id, 'Result: done, see attachment.');
		expect(comment.authorId).toBe(claude.id);
		expect(comment.body).toBe('Result: done, see attachment.');
		expect(task.updatedAt >= t.updatedAt).toBe(true);
		expect(getTask(db, t.id).comments).toHaveLength(1);
	});

	it('rejects empty bodies and missing tasks', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'x' });
		expect(() => addComment(db, micha, t.id, '  ')).toThrowError('body is required');
		expect(() => addComment(db, micha, 999, 'hi')).toThrowError('task not found');
	});
});
```

Create `src/lib/server/projects-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listProjects, createProject, updateProject } from './projects-service';
import { listUsers } from './projects-service';
import { testDb, seedUsers } from './test-utils';

describe('projects', () => {
	it('creates, lists, and archives projects', () => {
		const db = testDb();
		const p = createProject(db, { name: 'Website', color: '#3b82f6' });
		expect(p.archived).toBe(false);
		expect(() => createProject(db, { name: ' ' })).toThrowError('name is required');
		const archived = updateProject(db, p.id, { archived: true });
		expect(archived.archived).toBe(true);
		expect(listProjects(db)).toHaveLength(1);
		expect(() => updateProject(db, 99, { name: 'x' })).toThrowError('project not found');
	});
});

describe('listUsers', () => {
	it('returns safe users only', () => {
		const db = testDb();
		seedUsers(db);
		const all = listUsers(db);
		expect(all.map((u) => u.name).sort()).toEqual(['Claude', 'Micha']);
		expect(all[0]).not.toHaveProperty('passwordHash');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/comments-service.test.ts src/lib/server/projects-service.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `src/lib/server/comments-service.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, comments } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import type { CommentDTO, TaskDTO } from '$lib/types';

export function addComment(
	db: Db,
	user: SafeUser,
	taskId: number,
	body: string
): { comment: CommentDTO; task: TaskDTO } {
	if (!body?.trim()) throw new ServiceError(400, 'body is required');
	const existing = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
	if (!existing) throw new ServiceError(404, 'task not found');
	const now = new Date().toISOString();
	const comment = db
		.insert(comments)
		.values({ taskId, authorId: user.id, body: body.trim(), createdAt: now })
		.returning()
		.get();
	const task = db
		.update(tasks)
		.set({ updatedAt: now })
		.where(eq(tasks.id, taskId))
		.returning()
		.get();
	return { comment, task };
}
```

Create `src/lib/server/projects-service.ts`:

```ts
import { eq, asc } from 'drizzle-orm';
import type { Db } from './db';
import { projects, users } from './db/schema';
import { ServiceError } from './errors';
import { toSafeUser, type SafeUser } from './auth';
import type { ProjectDTO } from '$lib/types';

export function listProjects(db: Db): ProjectDTO[] {
	return db.select().from(projects).orderBy(asc(projects.name)).all();
}

export function createProject(db: Db, input: { name: string; color?: string }): ProjectDTO {
	if (!input.name?.trim()) throw new ServiceError(400, 'name is required');
	return db
		.insert(projects)
		.values({ name: input.name.trim(), color: input.color ?? '#6b7280' })
		.returning()
		.get();
}

export function updateProject(
	db: Db,
	id: number,
	patch: { name?: string; color?: string; archived?: boolean }
): ProjectDTO {
	const existing = db.select().from(projects).where(eq(projects.id, id)).get();
	if (!existing) throw new ServiceError(404, 'project not found');
	if (patch.name !== undefined && !patch.name.trim())
		throw new ServiceError(400, 'name is required');
	const next: Record<string, unknown> = {};
	if (patch.name !== undefined) next.name = patch.name.trim();
	if (patch.color !== undefined) next.color = patch.color;
	if (patch.archived !== undefined) next.archived = patch.archived;
	return db.update(projects).set(next).where(eq(projects.id, id)).returning().get();
}

export function listUsers(db: Db): SafeUser[] {
	return db.select().from(users).orderBy(asc(users.name)).all().map(toSafeUser);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: comments, projects, and user listing services"
```

---

### Task 8: SSE event broadcaster

**Files:**
- Create: `src/lib/server/events.ts`, `src/lib/server/events.test.ts`, `src/routes/api/events/+server.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 4); `TaskDTO`, `CommentDTO`.
- Produces:
  - `type TaskEvent = { type: 'task.created' | 'task.updated' | 'comment.created'; task: TaskDTO; comment?: CommentDTO }`
  - `subscribe(fn: (e: TaskEvent) => void): () => void`
  - `emit(e: TaskEvent): void`
  - `GET /api/events` — SSE stream, each event as `data: <json>\n\n`, keepalive comment every 25s.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { subscribe, emit, type TaskEvent } from './events';

describe('events', () => {
	it('delivers events to subscribers until unsubscribe', () => {
		const received: TaskEvent[] = [];
		const unsubscribe = subscribe((e) => received.push(e));
		const event = { type: 'task.updated', task: { id: 1 } } as unknown as TaskEvent;
		emit(event);
		expect(received).toEqual([event]);
		unsubscribe();
		emit(event);
		expect(received).toHaveLength(1);
	});

	it('a throwing subscriber does not break others', () => {
		const received: TaskEvent[] = [];
		const bad = subscribe(() => {
			throw new Error('boom');
		});
		const good = subscribe((e) => received.push(e));
		emit({ type: 'task.created', task: { id: 2 } } as unknown as TaskEvent);
		expect(received).toHaveLength(1);
		bad();
		good();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/server/events.ts`:

```ts
import type { TaskDTO, CommentDTO } from '$lib/types';

export type TaskEvent = {
	type: 'task.created' | 'task.updated' | 'comment.created';
	task: TaskDTO;
	comment?: CommentDTO;
};

const listeners = new Set<(e: TaskEvent) => void>();

export function subscribe(fn: (e: TaskEvent) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function emit(e: TaskEvent): void {
	for (const listener of listeners) {
		try {
			listener(e);
		} catch {
			// one broken client must not affect the others
		}
	}
}
```

Create `src/routes/api/events/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { run, requireUser } from '$lib/server/api-utils';
import { subscribe } from '$lib/server/events';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		requireUser(locals);
		let unsubscribe: () => void = () => {};
		let ping: ReturnType<typeof setInterval> | undefined;
		const stream = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				const send = (chunk: string) => {
					try {
						controller.enqueue(encoder.encode(chunk));
					} catch {
						unsubscribe();
						clearInterval(ping);
					}
				};
				send(': connected\n\n');
				unsubscribe = subscribe((e) => send(`data: ${JSON.stringify(e)}\n\n`));
				ping = setInterval(() => send(': ping\n\n'), 25000);
			},
			cancel() {
				unsubscribe();
				clearInterval(ping);
			}
		});
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	});
```

- [ ] **Step 4: Run tests and check**

Run: `npx vitest run && npm run check`
Expected: PASS, check clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: in-memory SSE broadcaster and /api/events stream"
```

---

### Task 9: REST endpoints for tasks, comments, projects, users

**Files:**
- Create: `src/routes/api/tasks/+server.ts`, `src/routes/api/tasks/[id]/+server.ts`, `src/routes/api/tasks/[id]/comments/+server.ts`, `src/routes/api/projects/+server.ts`, `src/routes/api/projects/[id]/+server.ts`, `src/routes/api/users/+server.ts`

**Interfaces:**
- Consumes: services (Tasks 5–7), `emit` (Task 8), `run`/`requireUser` (Task 4), `db` singleton.
- Produces: the full REST API from the spec. Endpoints are thin wrappers — no business logic here; wiring is covered by the Playwright e2e in Task 16.

- [ ] **Step 1: Implement all six endpoint files**

Create `src/routes/api/tasks/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listTasks, createTask, parseTaskFilters } from '$lib/server/tasks-service';
import { emit } from '$lib/server/events';

export const GET: RequestHandler = ({ locals, url }) =>
	run(() => {
		requireUser(locals);
		return json(listTasks(db, parseTaskFilters(url.searchParams)));
	});

export const POST: RequestHandler = ({ locals, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const task = createTask(db, user, await request.json().catch(() => ({})));
		emit({ type: 'task.created', task });
		return json(task, { status: 201 });
	});
```

Create `src/routes/api/tasks/[id]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { getTask, updateTask } from '$lib/server/tasks-service';
import { emit } from '$lib/server/events';

export const GET: RequestHandler = ({ locals, params }) =>
	run(() => {
		requireUser(locals);
		return json(getTask(db, Number(params.id)));
	});

export const PATCH: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const task = updateTask(db, user, Number(params.id), await request.json().catch(() => ({})));
		emit({ type: 'task.updated', task });
		return json(task);
	});
```

Create `src/routes/api/tasks/[id]/comments/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { addComment } from '$lib/server/comments-service';
import { emit } from '$lib/server/events';

export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const body = (await request.json().catch(() => ({}))).body as string;
		const { comment, task } = addComment(db, user, Number(params.id), body);
		emit({ type: 'comment.created', task, comment });
		return json(comment, { status: 201 });
	});
```

Create `src/routes/api/projects/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listProjects, createProject } from '$lib/server/projects-service';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		requireUser(locals);
		return json(listProjects(db));
	});

export const POST: RequestHandler = ({ locals, request }) =>
	run(async () => {
		requireUser(locals);
		return json(createProject(db, await request.json().catch(() => ({}))), { status: 201 });
	});
```

Create `src/routes/api/projects/[id]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { updateProject } from '$lib/server/projects-service';

export const PATCH: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		requireUser(locals);
		return json(updateProject(db, Number(params.id), await request.json().catch(() => ({}))));
	});
```

Create `src/routes/api/users/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listUsers } from '$lib/server/projects-service';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		requireUser(locals);
		return json(listUsers(db));
	});
```

- [ ] **Step 2: Verify by hand against the dev server**

```bash
npm run dev &
sleep 3
curl -s localhost:5173/api/tasks | head -c 200; echo
curl -s -X POST localhost:5173/api/tasks -H 'content-type: application/json' -d '{"title":"x"}'; echo
kill %1
```

Expected: both respond `{"error":"authentication required"}` (401) — auth wiring works end to end. Also run `npm run check` (clean).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: REST endpoints for tasks, comments, projects, users"
```

---

### Task 10: API docs endpoint

**Files:**
- Create: `src/lib/server/api-docs.ts`, `src/routes/api/docs/+server.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GET /api/docs` — `text/markdown`, no auth required (contains no data, agents read it before they have a key configured — it replaces the Notion workflow page).

- [ ] **Step 1: Implement**

Create `src/lib/server/api-docs.ts`:

```ts
export const API_DOCS = `# SmartTasks API

Task manager shared by humans and AI agents. Base URL: this host.

## Authentication
- Humans: \`POST /api/auth/login\` with \`{"email": "...", "password": "..."}\` → sets an httpOnly \`session\` cookie. \`POST /api/auth/logout\` ends it.
- AI agents: send \`Authorization: Bearer <api-key>\` on every request. Keys are issued by an admin (\`npm run seed\` / \`scripts/create-api-key.ts\`).

## Workflow for AI agents
1. Fetch your open tasks: \`GET /api/tasks?assignee=<your-user-name>&open=true\` (sorted by priority, then due date).
2. Work a task. Write your result as a comment: \`POST /api/tasks/:id/comments\` with \`{"body": "..."}\` (Markdown).
3. Set the task to Review: \`PATCH /api/tasks/:id\` with \`{"status": "Review"}\`.
4. Never set status \`Done\` — the server rejects it with 403. A human reviews and closes.
5. New findings worth tracking? Create a task assigned to yourself: \`POST /api/tasks\`.

## Endpoints
| Method & path | Purpose |
|---|---|
| GET /api/tasks | List. Query: assignee (user id or name), project (id), status, open=true (status ≠ Done), q (text search), limit, offset |
| POST /api/tasks | Create: {title, description?, status?, priority?, size?, hours?, dueDate?, assigneeId?, projectId?} |
| GET /api/tasks/:id | Detail incl. comments |
| PATCH /api/tasks/:id | Partial update (same fields as create) |
| POST /api/tasks/:id/comments | Add comment: {body} |
| GET /api/projects · POST /api/projects · PATCH /api/projects/:id | Projects: {name, color?, archived?} |
| GET /api/users | All users (id, name, type human/ai) |
| GET /api/events | SSE stream of task changes |

## Values
- status: Inbox | To Do | Icebox | In Progress | Supplier | Review | Done
- priority: Super-High | High | Medium | Low — size: S | M | L
- dueDate: YYYY-MM-DD. Errors: JSON {"error": "..."} with proper HTTP status.
`;
```

Create `src/routes/api/docs/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { API_DOCS } from '$lib/server/api-docs';

export const GET: RequestHandler = () =>
	new Response(API_DOCS, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
```

- [ ] **Step 2: Verify**

```bash
npm run dev &
sleep 3
curl -s localhost:5173/api/docs | head -5
kill %1
```

Expected: markdown starting with `# SmartTasks API`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: /api/docs — agent-readable API guide"
```

---

### Task 11: Seed and API-key scripts

**Files:**
- Create: `scripts/seed.ts`, `scripts/create-api-key.ts`

**Interfaces:**
- Consumes: `createDb` (Task 2), `createUser`, `setApiKey` (Task 3).
- Produces: `npm run seed` (create users, print generated passwords + Claude's API key once); `npx tsx scripts/create-api-key.ts <user-name>` (rotate/issue a key).

- [ ] **Step 1: Implement**

Create `scripts/seed.ts` (the Ulf/Holger addresses are placeholders by design — edit them to the real ones before the first production run):

```ts
import { randomBytes } from 'node:crypto';
import { createDb } from '../src/lib/server/db';
import { createUser, setApiKey } from '../src/lib/server/auth';

const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');

const HUMANS = [
	{ name: 'Micha', email: 'mic@dynamicdudes.com', color: '#ef4444' },
	{ name: 'Ulf', email: 'ulf@example.com', color: '#3b82f6' },
	{ name: 'Holger', email: 'holger@example.com', color: '#f59e0b' }
];

for (const human of HUMANS) {
	const password = randomBytes(9).toString('base64url');
	const user = createUser(db, { ...human, type: 'human', password });
	console.log(`${user.name} <${human.email}>  password: ${password}`);
}

const claude = createUser(db, { name: 'Claude', type: 'ai', color: '#8b5cf6' });
console.log(`Claude  api key: ${setApiKey(db, claude.id)}`);
console.log('\nStore these now — they are not retrievable later.');
```

(These scripts work under plain `tsx` because schema.ts imports types via a relative path — see Task 2.)

Create `scripts/create-api-key.ts`:

```ts
import { sql } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import { setApiKey } from '../src/lib/server/auth';

const name = process.argv[2];
if (!name) {
	console.error('usage: npx tsx scripts/create-api-key.ts <user-name>');
	process.exit(1);
}
const db = createDb(process.env.DATABASE_PATH ?? 'data/smarttasks.db');
const user = db.select().from(users).where(sql`lower(${users.name}) = lower(${name})`).get();
if (!user) {
	console.error(`user "${name}" not found`);
	process.exit(1);
}
console.log(setApiKey(db, user.id));
```

- [ ] **Step 2: Verify against a throwaway DB**

```bash
DATABASE_PATH=data/seed-test.db npm run seed
DATABASE_PATH=data/seed-test.db npx tsx scripts/create-api-key.ts Claude
rm -f data/seed-test.db*
```

Expected: three `name/password` lines plus a `st_…` key; the second command prints a fresh `st_…` key. Re-running seed on the same DB fails on the unique name constraint — that is intended (seed is one-shot).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: seed and api-key scripts"
```

---

### Task 12: App shell — global styles, login page, auth guard

**Files:**
- Create: `src/app.css`, `src/routes/login/+page.svelte`, `src/routes/login/+page.server.ts`, `src/routes/(app)/+layout.server.ts`, `src/routes/(app)/+page.svelte`
- Modify: `src/routes/+layout.svelte`; move the scaffold's `src/routes/+page.svelte` content out of the way (delete it — the board takes over `/` via the `(app)` group)

**Interfaces:**
- Consumes: `db`, services (list functions), `locals.user` (Task 4).
- Produces: `(app)` layout `load` returns `{ user, tasks, done, users, projects }` — Task 13's layout component consumes exactly these names. Unauthenticated visitors are redirected to `/login`.

- [ ] **Step 1: Implement**

Delete `src/routes/+page.svelte` (scaffold demo page).

Replace `src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

{@render children()}
```

Create `src/app.css`:

```css
:root {
	--bg: #f4f5f7;
	--surface: #ffffff;
	--border: #e2e4e9;
	--text: #1f2328;
	--muted: #6b7280;
	--accent: #2563eb;
	--danger: #dc2626;
	--radius: 8px;
	--shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: var(--bg);
	color: var(--text);
	font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
}

button,
input,
select,
textarea {
	font: inherit;
	color: inherit;
}

.badge {
	display: inline-block;
	padding: 1px 6px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 600;
	background: #eceef2;
	color: var(--muted);
	white-space: nowrap;
}

.badge.prio-super-high { background: #f3e8ff; color: #7c3aed; }
.badge.prio-high { background: #fee2e2; color: #dc2626; }
.badge.prio-medium { background: #fef3c7; color: #b45309; }
.badge.prio-low { background: #dcfce7; color: #15803d; }
.badge.overdue { background: #fee2e2; color: #dc2626; }

.avatar {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	border-radius: 50%;
	color: #fff;
	font-size: 11px;
	font-weight: 700;
}
```

Create `src/routes/login/+page.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(302, '/');
};
```

Create `src/routes/login/+page.svelte`:

```svelte
<script lang="ts">
	let email = $state('');
	let password = $state('');
	let error = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const res = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, password })
		});
		if (res.ok) location.href = '/';
		else error = (await res.json()).error ?? 'login failed';
	}
</script>

<svelte:head><title>SmartTasks — Login</title></svelte:head>

<main>
	<form onsubmit={submit}>
		<h1>SmartTasks</h1>
		<input type="email" placeholder="Email" bind:value={email} required />
		<input type="password" placeholder="Password" bind:value={password} required />
		{#if error}<p class="error">{error}</p>{/if}
		<button type="submit">Sign in</button>
	</form>
</main>

<style>
	main {
		display: grid;
		place-items: center;
		min-height: 100vh;
	}
	form {
		display: grid;
		gap: 10px;
		width: 300px;
		padding: 28px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	h1 {
		margin: 0 0 8px;
		font-size: 20px;
	}
	input {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	button {
		padding: 8px;
		border: 0;
		border-radius: 6px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.error {
		margin: 0;
		color: var(--danger);
		font-size: 13px;
	}
</style>
```

Create `src/routes/(app)/+layout.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listTasks } from '$lib/server/tasks-service';
import { listProjects, listUsers } from '$lib/server/projects-service';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		user: locals.user,
		tasks: listTasks(db, { open: true }),
		done: listTasks(db, { status: 'Done', limit: 50 }),
		users: listUsers(db),
		projects: listProjects(db)
	};
};
```

Create `src/routes/(app)/+page.svelte` (the board itself lives in the `(app)` layout, added in Task 13):

```svelte
<svelte:head><title>SmartTasks</title></svelte:head>
```

- [ ] **Step 2: Verify in the browser**

```bash
DATABASE_PATH=data/dev.db npm run seed   # once; note Micha's printed password
DATABASE_PATH=data/dev.db npm run dev
```

- Open `http://localhost:5173/` → redirected to `/login`.
- Wrong password → inline error. Correct login → redirected to `/` (blank page for now).
- `npm run check` → clean.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: app shell — global styles, login, auth guard"
```

---

### Task 13: Board UI — state store, columns, cards, filter bar

**Files:**
- Create: `src/lib/client/api.ts`, `src/lib/client/board.svelte.ts`, `src/lib/client/board.test.ts`, `src/lib/components/Board.svelte`, `src/lib/components/Column.svelte`, `src/lib/components/TaskCard.svelte`, `src/lib/components/FilterBar.svelte`, `src/routes/(app)/+layout.svelte`

**Interfaces:**
- Consumes: `{ user, tasks, done, users, projects }` from Task 12's layout load; DTOs and enums from `$lib/types`.
- Produces: singleton `board` (class `BoardState`) from `$lib/client/board.svelte` with: `me`, `tasks`, `users`, `projects`, `flashes`, `toasts`; methods `init(data)`, `filtered(params): TaskDTO[]`, `upsert(task, { flash? })`, `createTask(input)`, `patchTask(id, patch)`, `loadMoreDone()`, `refetch()`, `connectSse(): () => void`, `toast(message)`; exported `compareTasks(a, b)`. `api<T>(path, init?)` fetch wrapper from `$lib/client/api`. Later tasks call these exact names. (`createTask`/`patchTask`/drag-drop wiring is Task 14; SSE wiring is Task 15 — the methods are defined here once, complete.)

- [ ] **Step 1: Write the failing test**

Create `src/lib/client/board.test.ts` (pure logic only — `compareTasks` and filtering):

```ts
import { describe, it, expect } from 'vitest';
import { compareTasks } from './board.svelte';
import type { TaskDTO } from '$lib/types';

function task(over: Partial<TaskDTO>): TaskDTO {
	return {
		id: Math.floor(Math.random() * 1e6),
		title: 't',
		description: '',
		status: 'To Do',
		priority: null,
		size: null,
		hours: null,
		dueDate: null,
		assigneeId: null,
		projectId: null,
		createdBy: 1,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		completedAt: null,
		...over
	};
}

describe('compareTasks', () => {
	it('orders by priority, then due date (none last), then age', () => {
		const urgent = task({ priority: 'Super-High' });
		const low = task({ priority: 'Low' });
		const dueSoon = task({ dueDate: '2026-01-05' });
		const dueLater = task({ dueDate: '2026-06-01' });
		const noDue = task({ createdAt: '2025-01-01T00:00:00.000Z' });
		const sorted = [noDue, dueLater, low, dueSoon, urgent].sort(compareTasks);
		expect(sorted).toEqual([urgent, low, dueSoon, dueLater, noDue]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/client/board.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client core**

Create `src/lib/client/api.ts`:

```ts
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: { 'content-type': 'application/json', ...init?.headers }
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
	return res.json();
}
```

Create `src/lib/client/board.svelte.ts`:

```ts
import type { TaskDTO, UserDTO, ProjectDTO } from '$lib/types';
import { api } from './api';

const PRIORITY_ORDER: Record<string, number> = { 'Super-High': 0, High: 1, Medium: 2, Low: 3 };

export function compareTasks(a: TaskDTO, b: TaskDTO): number {
	const pa = a.priority ? PRIORITY_ORDER[a.priority] : 4;
	const pb = b.priority ? PRIORITY_ORDER[b.priority] : 4;
	if (pa !== pb) return pa - pb;
	if (a.dueDate !== b.dueDate) {
		if (a.dueDate === null) return 1;
		if (b.dueDate === null) return -1;
		return a.dueDate < b.dueDate ? -1 : 1;
	}
	return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

type InitData = {
	user: UserDTO;
	tasks: TaskDTO[];
	done: TaskDTO[];
	users: UserDTO[];
	projects: ProjectDTO[];
};

class BoardState {
	me = $state<UserDTO | null>(null);
	tasks = $state<TaskDTO[]>([]);
	users = $state<UserDTO[]>([]);
	projects = $state<ProjectDTO[]>([]);
	flashes = $state<Record<number, boolean>>({});
	toasts = $state<{ id: number; message: string }[]>([]);
	#toastId = 0;

	init(data: InitData) {
		this.me = data.user;
		this.tasks = [...data.tasks, ...data.done];
		this.users = data.users;
		this.projects = data.projects;
	}

	filtered(params: URLSearchParams): TaskDTO[] {
		const assignee = params.get('assignee');
		const project = params.get('project');
		const q = params.get('q')?.toLowerCase();
		return this.tasks
			.filter(
				(t) =>
					(!assignee || String(t.assigneeId) === assignee) &&
					(!project || String(t.projectId) === project) &&
					(!q ||
						t.title.toLowerCase().includes(q) ||
						t.description.toLowerCase().includes(q))
			)
			.sort(compareTasks);
	}

	upsert(task: TaskDTO, opts: { flash?: boolean } = {}) {
		const i = this.tasks.findIndex((t) => t.id === task.id);
		if (i === -1) this.tasks.push(task);
		else this.tasks[i] = task;
		if (opts.flash) {
			this.flashes[task.id] = true;
			setTimeout(() => delete this.flashes[task.id], 1500);
		}
	}

	async createTask(input: Partial<TaskDTO> & { title: string }) {
		try {
			this.upsert(await api<TaskDTO>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }));
		} catch (e) {
			this.toast((e as Error).message);
		}
	}

	async patchTask(id: number, patch: Partial<TaskDTO>) {
		const i = this.tasks.findIndex((t) => t.id === id);
		if (i === -1) return;
		const before = this.tasks[i];
		this.tasks[i] = { ...before, ...patch }; // optimistic
		try {
			const saved = await api<TaskDTO>(`/api/tasks/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(patch)
			});
			this.upsert(saved);
		} catch (e) {
			this.upsert(before); // rollback
			this.toast((e as Error).message);
		}
	}

	async loadMoreDone() {
		const offset = this.tasks.filter((t) => t.status === 'Done').length;
		const more = await api<TaskDTO[]>(`/api/tasks?status=Done&limit=50&offset=${offset}`);
		for (const t of more) this.upsert(t);
	}

	async refetch() {
		const [open, done] = await Promise.all([
			api<TaskDTO[]>('/api/tasks?open=true'),
			api<TaskDTO[]>('/api/tasks?status=Done&limit=50')
		]);
		this.tasks = [...open, ...done];
	}

	connectSse(): () => void {
		const es = new EventSource('/api/events');
		let dropped = false;
		es.onmessage = (m) => {
			const e = JSON.parse(m.data);
			if (e.task) this.upsert(e.task, { flash: true });
		};
		es.onerror = () => {
			dropped = true; // EventSource reconnects on its own
		};
		es.onopen = () => {
			if (dropped) {
				dropped = false;
				this.refetch(); // resync anything missed while offline
			}
		};
		return () => es.close();
	}

	toast(message: string) {
		const id = ++this.#toastId;
		this.toasts.push({ id, message });
		setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), 4000);
	}
}

export const board = new BoardState();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/client/board.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the components**

Create `src/lib/components/TaskCard.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { board } from '$lib/client/board.svelte';
	import type { TaskDTO } from '$lib/types';

	let { task }: { task: TaskDTO } = $props();

	const assignee = $derived(board.users.find((u) => u.id === task.assigneeId));
	const project = $derived(board.projects.find((p) => p.id === task.projectId));
	const overdue = $derived(
		!!task.dueDate && task.status !== 'Done' && task.dueDate < new Date().toISOString().slice(0, 10)
	);
</script>

<button
	class="card"
	class:flash={board.flashes[task.id]}
	draggable="true"
	ondragstart={(e) => e.dataTransfer?.setData('text/task-id', String(task.id))}
	onclick={() => goto(`/task/${task.id}${page.url.search}`)}
>
	<span class="title">{task.title}</span>
	<span class="meta">
		{#if task.priority}<span class="badge prio-{task.priority.toLowerCase()}">{task.priority}</span>{/if}
		{#if task.size}<span class="badge">{task.size}</span>{/if}
		{#if project}<span class="badge" style="background:{project.color}22;color:{project.color}">{project.name}</span>{/if}
		{#if task.dueDate}<span class="badge" class:overdue>{task.dueDate}</span>{/if}
		{#if assignee}<span class="avatar" style="background:{assignee.color}" title={assignee.name}>{assignee.name[0]}</span>{/if}
	</span>
</button>

<style>
	.card {
		display: grid;
		gap: 6px;
		width: 100%;
		padding: 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow);
		cursor: pointer;
		text-align: left;
	}
	.card:hover {
		border-color: var(--accent);
	}
	.card.flash {
		animation: flash 1.5s ease-out;
	}
	@keyframes flash {
		0% { background: #dbeafe; }
		100% { background: var(--surface); }
	}
	.title {
		font-weight: 500;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
	}
</style>
```

Create `src/lib/components/Column.svelte` (the `ondrop` wiring becomes live in Task 14; include it now so the file is complete):

```svelte
<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import QuickAdd from './QuickAdd.svelte';
	import { board } from '$lib/client/board.svelte';
	import type { Status, TaskDTO } from '$lib/types';

	let { status, tasks }: { status: Status; tasks: TaskDTO[] } = $props();

	function ondrop(e: DragEvent) {
		e.preventDefault();
		const id = Number(e.dataTransfer?.getData('text/task-id'));
		if (id) board.patchTask(id, { status });
	}
</script>

<section class="column" data-column={status} ondragover={(e) => e.preventDefault()} {ondrop}>
	<header>{status} <span class="count">{tasks.length}</span></header>
	<QuickAdd {status} />
	<div class="cards">
		{#each tasks as task (task.id)}
			<TaskCard {task} />
		{/each}
		{#if status === 'Done'}
			<button class="more" onclick={() => board.loadMoreDone()}>Load more</button>
		{/if}
	</div>
</section>

<style>
	.column {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 240px;
		width: 240px;
		flex-shrink: 0;
	}
	header {
		font-weight: 600;
		font-size: 13px;
		padding: 0 2px;
	}
	.count {
		color: var(--muted);
		font-weight: 400;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow-y: auto;
	}
	.more {
		padding: 6px;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
</style>
```

Create `src/lib/components/Board.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import Column from './Column.svelte';
	import { board } from '$lib/client/board.svelte';
	import { STATUSES } from '$lib/types';

	const filtered = $derived(board.filtered(page.url.searchParams));
</script>

<div class="board">
	{#each STATUSES as status (status)}
		<Column {status} tasks={filtered.filter((t) => t.status === status)} />
	{/each}
</div>

<style>
	.board {
		display: flex;
		gap: 14px;
		padding: 14px;
		overflow-x: auto;
		height: calc(100vh - 54px);
		align-items: flex-start;
	}
</style>
```

Create `src/lib/components/FilterBar.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { board } from '$lib/client/board.svelte';

	const current = $derived(new URLSearchParams(page.url.search));

	function setParam(key: string, value: string | null) {
		const params = new URLSearchParams(page.url.search);
		if (value) params.set(key, value);
		else params.delete(key);
		const qs = params.toString();
		goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function toggleAssignee(id: number) {
		const val = String(id);
		setParam('assignee', current.get('assignee') === val ? null : val);
	}
</script>

<nav>
	<strong>SmartTasks</strong>
	{#each board.users as u (u.id)}
		<button
			class="chip"
			class:active={current.get('assignee') === String(u.id)}
			style="--c:{u.color}"
			onclick={() => toggleAssignee(u.id)}
		>
			{u.name}{#if u.type === 'ai'}<span class="ai">AI</span>{/if}
		</button>
	{/each}
	<select onchange={(e) => setParam('project', e.currentTarget.value || null)}>
		<option value="">All projects</option>
		{#each board.projects.filter((p) => !p.archived) as p (p.id)}
			<option value={p.id} selected={current.get('project') === String(p.id)}>{p.name}</option>
		{/each}
	</select>
	<input
		type="search"
		placeholder="Search…"
		value={current.get('q') ?? ''}
		oninput={(e) => setParam('q', e.currentTarget.value || null)}
	/>
	<span class="spacer"></span>
	<span class="me">{board.me?.name}</span>
	<button
		class="logout"
		onclick={async () => {
			await fetch('/api/auth/logout', { method: 'POST' });
			location.href = '/login';
		}}>Logout</button
	>
</nav>

<style>
	nav {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.chip {
		padding: 3px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: none;
		cursor: pointer;
	}
	.chip.active {
		border-color: var(--c);
		background: color-mix(in srgb, var(--c) 15%, transparent);
		font-weight: 600;
	}
	.ai {
		margin-left: 4px;
		font-size: 10px;
		color: var(--muted);
	}
	select,
	input {
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.spacer {
		flex: 1;
	}
	.me {
		color: var(--muted);
	}
	.logout {
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
</style>
```

Create `src/routes/(app)/+layout.svelte`:

```svelte
<script lang="ts">
	import FilterBar from '$lib/components/FilterBar.svelte';
	import Board from '$lib/components/Board.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import { board } from '$lib/client/board.svelte';

	let { data, children } = $props();

	// re-init whenever the server load reruns (login change, hard reload)
	$effect.pre(() => {
		board.init(data);
	});
</script>

<FilterBar />
<Board />
{@render children()}
<Toasts />
```

Create `src/lib/components/Toasts.svelte`:

```svelte
<script lang="ts">
	import { board } from '$lib/client/board.svelte';
</script>

<div class="toasts">
	{#each board.toasts as t (t.id)}
		<div class="toast">{t.message}</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		bottom: 16px;
		right: 16px;
		display: grid;
		gap: 8px;
		z-index: 100;
	}
	.toast {
		padding: 10px 14px;
		background: #1f2328;
		color: #fff;
		border-radius: var(--radius);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
		max-width: 320px;
	}
</style>
```

QuickAdd is referenced by Column — create the real one now (it belongs to this render tree; its behavior is verified in Task 14):

Create `src/lib/components/QuickAdd.svelte`:

```svelte
<script lang="ts">
	import { board } from '$lib/client/board.svelte';
	import type { Status } from '$lib/types';

	let { status }: { status: Status } = $props();
	let title = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim()) return;
		await board.createTask({ title: title.trim(), status });
		title = '';
	}
</script>

<form onsubmit={submit}>
	<input placeholder="Add task…" bind:value={title} />
</form>

<style>
	input {
		width: 100%;
		padding: 6px 10px;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: none;
	}
	input:focus {
		background: var(--surface);
		border-style: solid;
		outline: none;
	}
</style>
```

- [ ] **Step 6: Verify in the browser**

With `DATABASE_PATH=data/dev.db npm run dev`, logged in as Micha:

- Board shows 7 columns in spec order.
- Create two tasks via curl (use the Claude API key printed by seed):
  `curl -s -X POST localhost:5173/api/tasks -H "Authorization: Bearer st_…" -H 'content-type: application/json' -d '{"title":"High prio","priority":"High","assigneeId":1}'` and one without priority — after a reload, the High card sorts above the other in Inbox.
- Clicking the `Micha` chip filters to assignee 1 and updates the URL (`?assignee=1`); search field narrows by title; filters survive a reload.
- `npm run check` → clean. `npx vitest run` → all pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: kanban board UI with filter bar and URL-backed filters"
```

---

### Task 14: Task detail slide-over panel

**Files:**
- Create: `src/lib/client/markdown.ts`, `src/routes/(app)/task/[id]/+page.svelte`

**Interfaces:**
- Consumes: `board` store, `api` wrapper (Task 13); `GET /api/tasks/:id`, `POST /api/tasks/:id/comments` (Task 9); enums from `$lib/types`.
- Produces: route `/task/:id` renders the board (from the persistent `(app)` layout) plus a slide-over panel; closing navigates back to `/` preserving the query string.

- [ ] **Step 1: Implement the markdown helper**

Create `src/lib/client/markdown.ts`:

```ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdown(text: string): string {
	return DOMPurify.sanitize(marked.parse(text, { async: false }));
}
```

- [ ] **Step 2: Implement the panel**

Create `src/routes/(app)/task/[id]/+page.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { board } from '$lib/client/board.svelte';
	import { renderMarkdown } from '$lib/client/markdown';
	import { STATUSES, PRIORITIES, SIZES } from '$lib/types';
	import type { TaskDTO, CommentDTO, Status, Priority, Size } from '$lib/types';

	type Detail = TaskDTO & { comments: CommentDTO[] };

	let detail = $state<Detail | null>(null);
	let commentBody = $state('');
	let editingDescription = $state(false);

	const id = $derived(Number(page.params.id));

	$effect(() => {
		api<Detail>(`/api/tasks/${id}`)
			.then((d) => (detail = d))
			.catch((e) => {
				board.toast((e as Error).message);
				close();
			});
	});

	function close() {
		goto(`/${page.url.search}`, { noScroll: true });
	}

	async function save(patch: Partial<TaskDTO>) {
		await board.patchTask(id, patch);
		const saved = board.tasks.find((t) => t.id === id);
		if (detail && saved) detail = { ...detail, ...saved };
	}

	async function addComment(e: SubmitEvent) {
		e.preventDefault();
		if (!commentBody.trim()) return;
		try {
			const comment = await api<CommentDTO>(`/api/tasks/${id}/comments`, {
				method: 'POST',
				body: JSON.stringify({ body: commentBody })
			});
			detail?.comments.push(comment);
			commentBody = '';
		} catch (err) {
			board.toast((err as Error).message);
		}
	}

	const userName = (uid: number | null) =>
		board.users.find((u) => u.id === uid)?.name ?? '—';
	const fmt = (iso: string) => iso.slice(0, 16).replace('T', ' ');
</script>

<div
	class="overlay"
	onclick={close}
	onkeydown={(e) => e.key === 'Escape' && close()}
	role="button"
	tabindex="-1"
	aria-label="Close panel"
></div>

<aside class="panel">
	{#if detail}
		<header>
			<input
				class="title"
				value={detail.title}
				onchange={(e) => save({ title: e.currentTarget.value })}
			/>
			<button class="close" onclick={close} aria-label="Close">×</button>
		</header>

		<div class="fields">
			<label>Status
				<select
					value={detail.status}
					onchange={(e) => save({ status: e.currentTarget.value as Status })}
				>
					{#each STATUSES as s (s)}<option>{s}</option>{/each}
				</select>
			</label>
			<label>Priority
				<select
					value={detail.priority ?? ''}
					onchange={(e) => save({ priority: (e.currentTarget.value || null) as Priority | null })}
				>
					<option value="">—</option>
					{#each PRIORITIES as p (p)}<option>{p}</option>{/each}
				</select>
			</label>
			<label>Size
				<select
					value={detail.size ?? ''}
					onchange={(e) => save({ size: (e.currentTarget.value || null) as Size | null })}
				>
					<option value="">—</option>
					{#each SIZES as s (s)}<option>{s}</option>{/each}
				</select>
			</label>
			<label>Assignee
				<select
					value={detail.assigneeId ?? ''}
					onchange={(e) => save({ assigneeId: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
				>
					<option value="">—</option>
					{#each board.users as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
				</select>
			</label>
			<label>Project
				<select
					value={detail.projectId ?? ''}
					onchange={(e) => save({ projectId: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
				>
					<option value="">—</option>
					{#each board.projects.filter((p) => !p.archived) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</label>
			<label>Due date
				<input
					type="date"
					value={detail.dueDate ?? ''}
					onchange={(e) => save({ dueDate: e.currentTarget.value || null })}
				/>
			</label>
			<label>Hours
				<input
					type="number"
					step="0.25"
					min="0"
					value={detail.hours ?? ''}
					onchange={(e) => save({ hours: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
				/>
			</label>
		</div>

		<section class="description">
			{#if editingDescription}
				<textarea
					value={detail.description}
					onblur={(e) => {
						save({ description: e.currentTarget.value });
						editingDescription = false;
					}}
				></textarea>
			{:else}
				<div
					class="rendered"
					onclick={() => (editingDescription = true)}
					onkeydown={(e) => e.key === 'Enter' && (editingDescription = true)}
					role="button"
					tabindex="0"
				>
					{#if detail.description}
						{@html renderMarkdown(detail.description)}
					{:else}
						<span class="hint">Add a description…</span>
					{/if}
				</div>
			{/if}
		</section>

		<section class="comments">
			<h3>Comments</h3>
			{#each detail.comments as c (c.id)}
				<article>
					<header>{userName(c.authorId)} · {fmt(c.createdAt)}</header>
					<div class="rendered">{@html renderMarkdown(c.body)}</div>
				</article>
			{/each}
			<form onsubmit={addComment}>
				<textarea bind:value={commentBody} placeholder="Add a comment… (Markdown)"></textarea>
				<button type="submit">Comment</button>
			</form>
		</section>

		<footer class="meta">
			Created by {userName(detail.createdBy)} · {fmt(detail.createdAt)}
			{#if detail.completedAt} · Completed {fmt(detail.completedAt)}{/if}
		</footer>
	{/if}
</aside>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.25);
		border: 0;
		z-index: 10;
	}
	.panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(480px, 95vw);
		background: var(--surface);
		border-left: 1px solid var(--border);
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
		z-index: 11;
		overflow-y: auto;
		padding: 18px;
		display: grid;
		gap: 16px;
		align-content: start;
	}
	header {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.title {
		flex: 1;
		font-size: 17px;
		font-weight: 600;
		border: 0;
		padding: 4px;
	}
	.title:focus {
		outline: 1px solid var(--accent);
		border-radius: 4px;
	}
	.close {
		border: 0;
		background: none;
		font-size: 22px;
		cursor: pointer;
		color: var(--muted);
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	label {
		display: grid;
		gap: 4px;
		font-size: 12px;
		color: var(--muted);
	}
	select,
	input[type='date'],
	input[type='number'] {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	textarea {
		width: 100%;
		min-height: 90px;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		resize: vertical;
	}
	.rendered {
		padding: 8px;
		border-radius: 6px;
		cursor: text;
	}
	.rendered:hover {
		background: var(--bg);
	}
	.hint {
		color: var(--muted);
	}
	.comments {
		display: grid;
		gap: 10px;
	}
	.comments h3 {
		margin: 0;
		font-size: 13px;
	}
	.comments article {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 8px 10px;
	}
	.comments article header {
		font-size: 12px;
		color: var(--muted);
	}
	.comments form {
		display: grid;
		gap: 6px;
	}
	.comments button {
		justify-self: end;
		padding: 6px 14px;
		border: 0;
		border-radius: 6px;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
	}
	.meta {
		font-size: 12px;
		color: var(--muted);
	}
</style>
```

- [ ] **Step 3: Verify in the browser**

With the dev server running, logged in as Micha:

- Click a card → panel slides over the board at `/task/<id>`; board stays visible behind the overlay.
- Change status via the select → the card moves columns behind the panel (optimistic).
- Edit title, set due date, priority — reload the page: values persist, and `/task/<id>` deep-links directly to the open panel.
- Add a comment with markdown (`**bold**`) → renders bold; author + timestamp shown.
- Click the overlay or press Escape → back on `/` with filters intact.
- `npm run check` → clean.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: task detail slide-over with inline editing, markdown, comments"
```

---

### Task 15: Live updates — SSE client wiring

**Files:**
- Modify: `src/routes/(app)/+layout.svelte`

**Interfaces:**
- Consumes: `board.connectSse()` (Task 13), `GET /api/events` (Task 8).
- Produces: the board reflects changes made by other sessions/agents within a second, with a highlight flash.

- [ ] **Step 1: Wire SSE into the layout**

In `src/routes/(app)/+layout.svelte`, add to the `<script>` block:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	// …existing imports and $effect.pre stay as-is…

	onMount(() => board.connectSse());
</script>
```

(`onMount` returning the disconnect function handles teardown.)

- [ ] **Step 2: Verify the full human+AI loop in the browser**

With the dev server running:

- Open the board in two browser windows, logged in as Micha.
- Window 1: quick-add a task in `To Do` → appears in window 2 within ~1s with a blue flash.
- Drag the card to `In Progress` in window 1 → moves in window 2.
- Simulate an agent (Claude's key from seed):
  `curl -s -X PATCH localhost:5173/api/tasks/<id> -H "Authorization: Bearer st_…" -H 'content-type: application/json' -d '{"status":"Review"}'` → card jumps to Review in both windows.
- The forbidden transition:
  `curl -s -X PATCH localhost:5173/api/tasks/<id> -H "Authorization: Bearer st_…" -H 'content-type: application/json' -d '{"status":"Done"}'` → `{"error":"AI users cannot set status to Done"}`, board unchanged.
- Rollback: stop the dev server, drag a card → it snaps back and a toast shows the error; restart the server.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: live board updates via SSE"
```

---

### Task 16: Playwright smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/seed.ts`, `e2e/board.spec.ts`

**Interfaces:**
- Consumes: the whole app; `createDb`, `createUser` (Tasks 2–3), `createProject` (Task 7).
- Produces: `npm run test:e2e` — builds, seeds a throwaway DB, runs the production server, and exercises the core flow in Chromium.

- [ ] **Step 1: Write the seed + config**

Create `e2e/seed.ts`:

```ts
import { rmSync } from 'node:fs';
import { createDb } from '../src/lib/server/db';
import { createUser } from '../src/lib/server/auth';
import { createProject } from '../src/lib/server/projects-service';

rmSync('.e2e', { recursive: true, force: true });
const db = createDb('.e2e/test.db');
createUser(db, { name: 'Micha', email: 'micha@e2e.test', type: 'human', password: 'e2e-password-1' });
createUser(db, { name: 'Claude', type: 'ai', color: '#8b5cf6' });
createProject(db, { name: 'Website' });
console.log('e2e db seeded');
```

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	use: { baseURL: 'http://localhost:4173' },
	webServer: {
		command:
			'npm run build && npx tsx e2e/seed.ts && DATABASE_PATH=.e2e/test.db PORT=4173 node build',
		url: 'http://localhost:4173',
		reuseExistingServer: false,
		timeout: 180_000
	}
});
```

- [ ] **Step 2: Write the failing test**

Create `e2e/board.spec.ts`:

```ts
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

	// drag to In Progress
	await card.dragTo(page.locator('[data-column="In Progress"] .cards'));
	await expect(
		page.locator('[data-column="In Progress"]').locator('.card', { hasText: 'Order the wood' })
	).toBeVisible();

	// open detail, add a comment
	await card.click();
	await expect(page).toHaveURL(/\/task\/\d+/);
	await page.getByPlaceholder('Add a comment… (Markdown)').fill('Called the supplier.');
	await page.getByRole('button', { name: 'Comment' }).click();
	await expect(page.getByText('Called the supplier.')).toBeVisible();
	await expect(page.getByText('Micha ·')).toBeVisible();
});
```

- [ ] **Step 3: Run it**

```bash
npx playwright install chromium   # once
npm run test:e2e
```

Expected: 1 test PASS. If the HTML5 drag proves flaky in CI, replace the `dragTo` block with a status change via the detail panel select and note it in the test — the drag path stays covered by the manual check in Task 15.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: playwright smoke — login, quick-add, drag, comment"
```

---

### Task 17: Deployment — Docker, Fly.io, Litestream

**Files:**
- Create: `Dockerfile`, `docker-entrypoint.sh`, `litestream.yml`, `fly.toml`, `.dockerignore`, `README.md`

**Interfaces:**
- Consumes: the built app (`node build`), `drizzle/` migrations (applied at boot by `createDb`), env vars `DATABASE_PATH`, `PORT`, `ORIGIN`, `LITESTREAM_REPLICA_URL`.
- Produces: a deployable container; `fly deploy` ships it.

- [ ] **Step 1: Write the container files**

Create `.dockerignore`:

```
node_modules
build
data
.e2e
.git
docs
```

Create `Dockerfile`:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb /tmp/litestream.deb
RUN dpkg -i /tmp/litestream.deb && rm /tmp/litestream.deb
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/drizzle ./drizzle
COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production DATABASE_PATH=/data/smarttasks.db PORT=3000
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
```

Create `docker-entrypoint.sh`:

```sh
#!/bin/sh
set -e
if [ -n "$LITESTREAM_REPLICA_URL" ]; then
	litestream restore -if-db-not-exists -if-replica-exists "$DATABASE_PATH"
	exec litestream replicate -exec "node build"
else
	exec node build
fi
```

Create `litestream.yml`:

```yaml
dbs:
  - path: /data/smarttasks.db
    replicas:
      - url: ${LITESTREAM_REPLICA_URL}
```

Create `fly.toml`:

```toml
app = "smarttasks"
primary_region = "fra"

[env]
  DATABASE_PATH = "/data/smarttasks.db"
  PORT = "3000"
  ORIGIN = "https://smarttasks.fly.dev"

[mounts]
  source = "smarttasks_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false      # SSE connections + snappiness: keep the machine warm
  auto_start_machines = true
  min_machines_running = 1
```

Create `README.md`:

```markdown
# SmartTasks

Lean kanban task manager for humans and AI agents. SvelteKit + SQLite, one process.

## Development
	npm install
	DATABASE_PATH=data/dev.db npm run seed   # once; prints passwords + Claude's API key
	DATABASE_PATH=data/dev.db npm run dev

## Tests
	npm run test:unit
	npm run test:e2e

## API
Agents authenticate with `Authorization: Bearer <api-key>` — full guide at `/api/docs`.
Issue/rotate a key: `npx tsx scripts/create-api-key.ts <user-name>`.

## Deploy (Fly.io)
	fly launch --no-deploy          # once; creates the app, keep the generated name in fly.toml
	fly volumes create smarttasks_data --size 1
	fly secrets set LITESTREAM_REPLICA_URL=s3://<bucket>/smarttasks AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…
	fly deploy
	fly ssh console -C "npm run seed"   # once, on the first deploy

Without `LITESTREAM_REPLICA_URL` the app runs fine but unreplicated (volume snapshots only).
```

- [ ] **Step 2: Verify the container locally**

```bash
docker build -t smarttasks .
docker run --rm -p 3000:3000 -v smarttasks-test:/data smarttasks &
sleep 3
curl -s localhost:3000/api/docs | head -3
curl -s localhost:3000/api/tasks   # {"error":"authentication required"}
docker stop $(docker ps -q --filter ancestor=smarttasks)
```

Expected: docs markdown + 401 JSON. (Skip gracefully if Docker isn't available locally — then this is verified on first `fly deploy`.)

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: dockerfile, fly.io config, litestream replication, readme"
```

---

## Post-plan verification

After all tasks: run the full suite (`npm run check && npm run test:unit && npm run test:e2e`), then walk the spec's UI section once by hand (Task 15 Step 2 covers the human+AI loop). First production deploy follows README → seed → send Micha the printed credentials → point agents at `/api/docs`.
