# SmartTasks v1.1 — Locations & Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add locations (own table, one per project, API-only management, board filter, TheBrain2 wikiRef) and a mobile layout (single column + status tabs, full-screen detail sheet).

**Architecture:** Extends the shipped v1 app in place. New `locations` table + service + endpoints following the exact patterns of `projects`. Board gains a client-side location filter and a `MediaQuery`-switched mobile branch — one store, one codebase, no new routes.

**Tech Stack:** unchanged (SvelteKit 2, Svelte 5 runes, Drizzle/better-sqlite3, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-07-07-smarttasks-v1.1-design.md`

## Global Constraints

- Same conventions as v1: services take `db` first, throw `ServiceError(status, message)`; endpoints are thin `run()`/`requireUser()` wrappers returning JSON; errors are `{ "error": ... }`.
- Locations: `name` unique, trimmed, non-empty (400 `name is required`); 404 `location not found`; empty PATCH is a no-op returning the unchanged row.
- Projects: `locationId` must reference an existing location → else 400 `invalid locationId: location not found`; `wikiRef` is `string | null`.
- Tasks filter: `location=<id>` matches tasks whose project has that location; tasks without a project never match.
- Mobile breakpoint: `max-width: 767px`. Mobile board = one column + status chip tabs with counts, initial status `Inbox`, selection is local state (not URL). Desktop unchanged.
- TDD for all server logic. UI copy English. Commit at the end of every task.
- A dev server may already be running on port 5173 — for any manual curl verification use `npm run dev -- --port 5175` and kill it afterwards.

---

### Task 1: Schema, migration, shared types

**Files:**
- Modify: `src/lib/server/db/schema.ts`, `src/lib/types.ts`, `src/lib/server/db/db.test.ts`
- Create: new migration under `drizzle/` (generated)

**Interfaces:**
- Produces: `locations` table (`id`, `name` unique, `archived` bool default false); `projects.locationId` (nullable FK), `projects.wikiRef` (nullable text); `LocationDTO = { id: number; name: string; archived: boolean }`; `ProjectDTO` extended with `locationId: number | null; wikiRef: string | null`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/db/db.test.ts` inside `describe('db', ...)` (extend the schema import with `locations, projects`):

```ts
	it('supports locations and project location/wikiRef', () => {
		const db = createDb(':memory:');
		const loc = db.insert(locations).values({ name: 'Schiffmühle' }).returning().get();
		expect(loc.archived).toBe(false);
		const project = db
			.insert(projects)
			.values({ name: 'Teichbau', locationId: loc.id, wikiRef: 'Teichbau Schiffmühle' })
			.returning()
			.get();
		expect(project.locationId).toBe(loc.id);
		expect(project.wikiRef).toBe('Teichbau Schiffmühle');
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/db/db.test.ts`
Expected: FAIL — `locations` is not exported / column does not exist.

- [ ] **Step 3: Implement**

In `src/lib/server/db/schema.ts`, insert after the `sessions` table:

```ts
export const locations = sqliteTable('locations', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
});
```

and extend the `projects` table definition to:

```ts
export const projects = sqliteTable('projects', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	color: text('color').notNull().default('#6b7280'),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
	locationId: integer('location_id').references(() => locations.id),
	wikiRef: text('wiki_ref')
});
```

(`locations` must be declared before `projects`.)

In `src/lib/types.ts`, add above `ProjectDTO`:

```ts
export type LocationDTO = {
	id: number;
	name: string;
	archived: boolean;
};
```

and extend `ProjectDTO` to:

```ts
export type ProjectDTO = {
	id: number;
	name: string;
	color: string;
	archived: boolean;
	locationId: number | null;
	wikiRef: string | null;
};
```

Generate the migration:

```bash
npx drizzle-kit generate
```

Expected: a new SQL file under `drizzle/` creating `locations` and altering `projects`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npm run check`
Expected: all PASS, check clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: locations table and project location/wikiRef columns"
```

---

### Task 2: Locations service + project extension

**Files:**
- Create: `src/lib/server/locations-service.ts`, `src/lib/server/locations-service.test.ts`
- Modify: `src/lib/server/projects-service.ts`, `src/lib/server/projects-service.test.ts`

**Interfaces:**
- Consumes: `locations`/`projects` tables (Task 1), `ServiceError`, `Db`, `LocationDTO`/`ProjectDTO`.
- Produces:
  - `listLocations(db): LocationDTO[]` (all incl. archived, name asc)
  - `createLocation(db, input: { name: string }): LocationDTO`
  - `updateLocation(db, id: number, patch: { name?: string; archived?: boolean }): LocationDTO`
  - `createProject(db, input: { name: string; color?: string; locationId?: number | null; wikiRef?: string | null }): ProjectDTO`
  - `updateProject(db, id, patch: { name?; color?; archived?; locationId?: number | null; wikiRef?: string | null }): ProjectDTO`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/locations-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listLocations, createLocation, updateLocation } from './locations-service';
import { testDb } from './test-utils';

describe('locations', () => {
	it('creates, lists (name asc), renames, and archives', () => {
		const db = testDb();
		const b = createLocation(db, { name: 'Wohnwerk Wandlitz' });
		const a = createLocation(db, { name: '  Schiffmühle  ' });
		expect(a.name).toBe('Schiffmühle');
		expect(listLocations(db).map((l) => l.name)).toEqual(['Schiffmühle', 'Wohnwerk Wandlitz']);
		expect(updateLocation(db, b.id, { archived: true }).archived).toBe(true);
		expect(updateLocation(db, a.id, { name: 'Zukunftspark' }).name).toBe('Zukunftspark');
	});

	it('rejects empty names, 404s, and no-ops on empty patch', () => {
		const db = testDb();
		expect(() => createLocation(db, { name: '  ' })).toThrowError('name is required');
		expect(() => updateLocation(db, 99, { name: 'x' })).toThrowError('location not found');
		const l = createLocation(db, { name: 'Office' });
		expect(() => updateLocation(db, l.id, { name: ' ' })).toThrowError('name is required');
		expect(updateLocation(db, l.id, {})).toEqual(l);
	});
});
```

Append to `src/lib/server/projects-service.test.ts` inside `describe('projects', ...)` (add `createLocation` to imports from `./locations-service`):

```ts
	it('accepts a valid locationId and wikiRef, rejects unknown/invalid ones', () => {
		const db = testDb();
		const loc = createLocation(db, { name: 'Schiffmühle' });
		const p = createProject(db, { name: 'Teichbau', locationId: loc.id, wikiRef: 'Teichbau Schiffmühle' });
		expect(p.locationId).toBe(loc.id);
		expect(p.wikiRef).toBe('Teichbau Schiffmühle');
		expect(() => createProject(db, { name: 'x', locationId: 999 })).toThrowError(
			'invalid locationId: location not found'
		);
		// @ts-expect-error wrong type on purpose
		expect(() => createProject(db, { name: 'x', wikiRef: 5 })).toThrowError(
			'invalid wikiRef: must be a string'
		);
		const cleared = updateProject(db, p.id, { locationId: null, wikiRef: null });
		expect(cleared.locationId).toBeNull();
		expect(cleared.wikiRef).toBeNull();
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/locations-service.test.ts src/lib/server/projects-service.test.ts`
Expected: FAIL — module `./locations-service` not found; project test fails on unknown fields.

- [ ] **Step 3: Implement**

Create `src/lib/server/locations-service.ts`:

```ts
import { eq, asc } from 'drizzle-orm';
import type { Db } from './db';
import { locations } from './db/schema';
import { ServiceError } from './errors';
import type { LocationDTO } from '$lib/types';

export function listLocations(db: Db): LocationDTO[] {
	return db.select().from(locations).orderBy(asc(locations.name)).all();
}

export function createLocation(db: Db, input: { name: string }): LocationDTO {
	if (typeof input.name !== 'string' || !input.name.trim())
		throw new ServiceError(400, 'name is required');
	return db.insert(locations).values({ name: input.name.trim() }).returning().get();
}

export function updateLocation(
	db: Db,
	id: number,
	patch: { name?: string; archived?: boolean }
): LocationDTO {
	const existing = db.select().from(locations).where(eq(locations.id, id)).get();
	if (!existing) throw new ServiceError(404, 'location not found');
	if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim()))
		throw new ServiceError(400, 'name is required');
	const next: Record<string, unknown> = {};
	if (patch.name !== undefined) next.name = patch.name.trim();
	if (patch.archived !== undefined) next.archived = patch.archived;
	if (Object.keys(next).length === 0) return existing;
	return db.update(locations).set(next).where(eq(locations.id, id)).returning().get();
}
```

Modify `src/lib/server/projects-service.ts`: extend the schema import to `import { projects, users, locations } from './db/schema';` and replace `createProject` and `updateProject` with:

```ts
function assertLocationId(db: Db, locationId: number | null | undefined): void {
	if (locationId === null || locationId === undefined) return;
	if (typeof locationId !== 'number')
		throw new ServiceError(400, 'invalid locationId: must be a number');
	const loc = db.select().from(locations).where(eq(locations.id, locationId)).get();
	if (!loc) throw new ServiceError(400, 'invalid locationId: location not found');
}

function assertWikiRef(wikiRef: unknown): void {
	if (wikiRef !== null && wikiRef !== undefined && typeof wikiRef !== 'string')
		throw new ServiceError(400, 'invalid wikiRef: must be a string');
}

export function createProject(
	db: Db,
	input: { name: string; color?: string; locationId?: number | null; wikiRef?: string | null }
): ProjectDTO {
	if (!input.name?.trim()) throw new ServiceError(400, 'name is required');
	assertLocationId(db, input.locationId);
	assertWikiRef(input.wikiRef);
	return db
		.insert(projects)
		.values({
			name: input.name.trim(),
			color: input.color ?? '#6b7280',
			locationId: input.locationId ?? null,
			wikiRef: input.wikiRef ?? null
		})
		.returning()
		.get();
}

export function updateProject(
	db: Db,
	id: number,
	patch: {
		name?: string;
		color?: string;
		archived?: boolean;
		locationId?: number | null;
		wikiRef?: string | null;
	}
): ProjectDTO {
	const existing = db.select().from(projects).where(eq(projects.id, id)).get();
	if (!existing) throw new ServiceError(404, 'project not found');
	if (patch.name !== undefined && !patch.name.trim())
		throw new ServiceError(400, 'name is required');
	if ('locationId' in patch) assertLocationId(db, patch.locationId);
	if ('wikiRef' in patch) assertWikiRef(patch.wikiRef);
	const next: Record<string, unknown> = {};
	if (patch.name !== undefined) next.name = patch.name.trim();
	if (patch.color !== undefined) next.color = patch.color;
	if (patch.archived !== undefined) next.archived = patch.archived;
	if ('locationId' in patch) next.locationId = patch.locationId ?? null;
	if ('wikiRef' in patch) next.wikiRef = patch.wikiRef ?? null;
	if (Object.keys(next).length === 0) return existing;
	return db.update(projects).set(next).where(eq(projects.id, id)).returning().get();
}
```

(`listProjects` and `listUsers` stay unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: locations service and project location/wikiRef support"
```

---

### Task 3: Tasks location filter

**Files:**
- Modify: `src/lib/server/tasks-service.ts`, `src/lib/server/tasks-service.test.ts`

**Interfaces:**
- Consumes: `projects` table, existing `TaskFilters`/`listTasks`/`parseTaskFilters`.
- Produces: `TaskFilters.location?: number`; `listTasks` honors it (tasks whose project has that location; projectless tasks never match); `parseTaskFilters` reads `location` from the query string.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/server/tasks-service.test.ts` inside `describe('listTasks', ...)` (add `createProject` from `./projects-service` and `createLocation` from `./locations-service` to the imports):

```ts
	it('filters by location via the task project', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const schiff = createLocation(db, { name: 'Schiffmühle' });
		const teich = createProject(db, { name: 'Teichbau', locationId: schiff.id });
		const other = createProject(db, { name: 'Elsewhere' });
		createTask(db, micha, { title: 'Teich ausheben', projectId: teich.id });
		createTask(db, micha, { title: 'Other work', projectId: other.id });
		createTask(db, micha, { title: 'No project' });
		expect(listTasks(db, { location: schiff.id }).map((t) => t.title)).toEqual(['Teich ausheben']);
		expect(listTasks(db, { location: schiff.id, open: true })).toHaveLength(1);
		expect(listTasks(db, { location: 999 })).toEqual([]);
	});
```

And to `describe('parseTaskFilters', ...)`:

```ts
	it('parses the location param', () => {
		expect(parseTaskFilters(new URLSearchParams('location=7'))).toEqual({ location: 7 });
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/tasks-service.test.ts`
Expected: FAIL — location filter not applied / not parsed.

- [ ] **Step 3: Implement**

In `src/lib/server/tasks-service.ts`:

1. Extend the schema import to `import { tasks, users, comments, projects } from './db/schema';`
2. Add `location?: number;` to `TaskFilters` (after `project?: number;`).
3. In `listTasks`, after the `filters.project` condition, add:

```ts
	if (filters.location !== undefined)
		conds.push(
			sql`${tasks.projectId} IN (SELECT ${projects.id} FROM ${projects} WHERE ${projects.locationId} = ${filters.location})`
		);
```

4. In `parseTaskFilters`, after the `project` block, add:

```ts
	const location = params.get('location');
	if (location) f.location = Number(location);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: filter tasks by project location"
```

---

### Task 4: Locations endpoints, docs, initial data

**Files:**
- Create: `src/routes/api/locations/+server.ts`, `src/routes/api/locations/[id]/+server.ts`
- Modify: `src/lib/server/api-docs.ts`, `src/routes/(app)/+layout.server.ts`

**Interfaces:**
- Consumes: locations service (Task 2), `run`/`requireUser`, `db`.
- Produces: `GET/POST /api/locations`, `PATCH /api/locations/:id`; `(app)` layout load additionally returns `locations: listLocations(db)` — Task 5's store init consumes this exact key.

- [ ] **Step 1: Implement the endpoints**

Create `src/routes/api/locations/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { listLocations, createLocation } from '$lib/server/locations-service';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		requireUser(locals);
		return json(listLocations(db));
	});

export const POST: RequestHandler = ({ locals, request }) =>
	run(async () => {
		requireUser(locals);
		return json(createLocation(db, await request.json().catch(() => ({}))), { status: 201 });
	});
```

Create `src/routes/api/locations/[id]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { updateLocation } from '$lib/server/locations-service';

export const PATCH: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		requireUser(locals);
		return json(updateLocation(db, Number(params.id), await request.json().catch(() => ({}))));
	});
```

- [ ] **Step 2: Update the API docs**

In `src/lib/server/api-docs.ts`:

1. Replace the projects row of the endpoints table with:

```
| GET /api/projects · POST /api/projects · PATCH /api/projects/:id | Projects: {name, color?, archived?, locationId?, wikiRef?} |
| GET /api/locations · POST /api/locations · PATCH /api/locations/:id | Locations: {name, archived?} |
```

2. In the `GET /api/tasks` row, extend the query list: after `project (id),` insert `location (id, matches the task's project location),`.

3. Append a new section before the final backtick:

```
## Projects, locations & TheBrain2
Projects and locations are maintained via this API only — there is no management UI.
A project may carry a \`wikiRef\`: the page name of its knowledge page in the TheBrain2
vault (\`wiki/projekte/<wikiRef>.md\`). When you work a task, read that page for project
context if a wikiRef is set. Locations are physical places; each project has at most one.
```

- [ ] **Step 3: Extend the layout load**

In `src/routes/(app)/+layout.server.ts`, add `import { listLocations } from '$lib/server/locations-service';` and add `locations: listLocations(db)` to the returned object (after `projects`).

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run check`
Expected: PASS / clean. Then a quick endpoint check:

```bash
npm run dev -- --port 5175 &
sleep 3
curl -s localhost:5175/api/locations
curl -s localhost:5175/api/docs | grep -c 'locations'
kill %1
```

Expected: `{"error":"authentication required"}` and a count ≥ 2.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: locations endpoints, api docs, layout data"
```

---

### Task 5: Desktop UI — location filter + project labels

**Files:**
- Modify: `src/lib/client/board.svelte.ts`, `src/lib/client/board.test.ts`, `src/lib/components/FilterBar.svelte`, `src/routes/(app)/task/[id]/+page.svelte`

**Interfaces:**
- Consumes: layout load key `locations` (Task 4); `LocationDTO`.
- Produces: `board.locations: LocationDTO[]`; `board.filtered` honors `location` URL param; `board.projectLabel(p: ProjectDTO): string` → `"Name (Location)"` or `"Name"`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/client/board.test.ts` (import `board` alongside `compareTasks`; `LocationDTO`/`ProjectDTO` via `$lib/types`):

```ts
describe('location filter and labels', () => {
	it('filters by the project location and labels projects', () => {
		board.init({
			user: { id: 1, name: 'M', email: null, type: 'human', color: '#fff' },
			tasks: [
				task({ id: 1, projectId: 10 }),
				task({ id: 2, projectId: 20 }),
				task({ id: 3, projectId: null })
			],
			done: [],
			users: [],
			projects: [
				{ id: 10, name: 'Teichbau', color: '#fff', archived: false, locationId: 5, wikiRef: null },
				{ id: 20, name: 'Elsewhere', color: '#fff', archived: false, locationId: null, wikiRef: null }
			],
			locations: [{ id: 5, name: 'Schiffmühle', archived: false }]
		});
		expect(board.filtered(new URLSearchParams('location=5')).map((t) => t.id)).toEqual([1]);
		expect(board.projectLabel(board.projects[0])).toBe('Teichbau (Schiffmühle)');
		expect(board.projectLabel(board.projects[1])).toBe('Elsewhere');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/client/board.test.ts`
Expected: FAIL — `locations` not in InitData / methods missing.

- [ ] **Step 3: Implement the store changes**

In `src/lib/client/board.svelte.ts`:

1. Extend the types import: `import type { TaskDTO, UserDTO, ProjectDTO, LocationDTO } from '$lib/types';`
2. Add `locations: LocationDTO[];` to `InitData` (after `projects`).
3. Add the state field `locations = $state<LocationDTO[]>([]);` (after `projects`) and `this.locations = data.locations;` in `init`.
4. In `filtered`, read `const location = params.get('location');` and add this predicate to the `.filter(...)` conjunction:

```ts
				(!location ||
					this.projects.find((p) => p.id === t.projectId)?.locationId === Number(location)) &&
```

5. Add the method:

```ts
	projectLabel(p: ProjectDTO): string {
		const loc = this.locations.find((l) => l.id === p.locationId);
		return loc ? `${p.name} (${loc.name})` : p.name;
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/client/board.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the UI**

In `src/lib/components/FilterBar.svelte`, after the closing `</select>` of the project select, add:

```svelte
	<select onchange={(e) => setParam('location', e.currentTarget.value || null)}>
		<option value="">All locations</option>
		{#each board.locations.filter((l) => !l.archived) as l (l.id)}
			<option value={l.id} selected={current.get('location') === String(l.id)}>{l.name}</option>
		{/each}
	</select>
```

and change the project option content from `{p.name}` to `{board.projectLabel(p)}`.

In `src/routes/(app)/task/[id]/+page.svelte`, in the Project select, change the option content from `{p.name}` to `{board.projectLabel(p)}`.

- [ ] **Step 6: Verify in the browser**

`npm run dev -- --port 5175` with the seeded dev db; create a location + project via curl (Bearer key or session):
`curl -s -X POST localhost:5175/api/locations -H 'Authorization: Bearer <key>' -H 'content-type: application/json' -d '{"name":"Schiffmühle"}'` and
`curl -s -X POST localhost:5175/api/projects -H 'Authorization: Bearer <key>' -H 'content-type: application/json' -d '{"name":"Teichbau","locationId":1,"wikiRef":"Teichbau Schiffmühle"}'`.
Then in the browser: project dropdowns show `Teichbau (Schiffmühle)`; selecting the location in the filter bar narrows the board and writes `?location=1`; `npm run check` clean. Kill the dev server.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: location filter and project location labels"
```

---

### Task 6: Mobile layout — status tabs, single column, sheet panel

**Files:**
- Modify: `src/lib/components/Board.svelte`, `src/lib/components/Column.svelte`, `src/lib/components/FilterBar.svelte`, `src/routes/(app)/task/[id]/+page.svelte`

**Interfaces:**
- Consumes: `board.filtered`, `compareDone`, `STATUSES`.
- Produces: below 768px the board renders `.status-tabs` (chips `.tab` with counts) + exactly one `[data-column]`; the detail panel becomes a 100vw sheet. Task 7's e2e relies on the class names `.status-tabs` and `.tab`.

- [ ] **Step 1: Rewrite Board.svelte**

Replace `src/lib/components/Board.svelte` with:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { MediaQuery } from 'svelte/reactivity';
	import Column from './Column.svelte';
	import { board, compareDone } from '$lib/client/board.svelte';
	import { STATUSES, type Status } from '$lib/types';

	const filtered = $derived(board.filtered(page.url.searchParams));
	const isMobile = new MediaQuery('(max-width: 767px)');
	let mobileStatus = $state<Status>('Inbox');

	function columnTasks(status: Status) {
		const inColumn = filtered.filter((t) => t.status === status);
		return status === 'Done' ? inColumn.sort(compareDone) : inColumn;
	}
</script>

{#if isMobile.current}
	<div class="board mobile">
		<nav class="status-tabs">
			{#each STATUSES as status (status)}
				<button
					class="tab"
					class:active={mobileStatus === status}
					onclick={() => (mobileStatus = status)}
				>
					{status} <span class="count">{columnTasks(status).length}</span>
				</button>
			{/each}
		</nav>
		<Column status={mobileStatus} tasks={columnTasks(mobileStatus)} />
	</div>
{:else}
	<div class="board">
		{#each STATUSES as status (status)}
			<Column {status} tasks={columnTasks(status)} />
		{/each}
	</div>
{/if}

<style>
	.board {
		display: flex;
		gap: 14px;
		padding: 14px;
		overflow-x: auto;
		height: calc(100vh - 54px);
		align-items: flex-start;
	}
	.board.mobile {
		flex-direction: column;
		align-items: stretch;
		overflow-x: hidden;
		overflow-y: auto;
		gap: 10px;
	}
	.status-tabs {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		flex-shrink: 0;
		padding-bottom: 2px;
	}
	.tab {
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		white-space: nowrap;
		cursor: pointer;
		min-height: 44px;
	}
	.tab.active {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
		font-weight: 600;
	}
	.tab .count {
		color: var(--muted);
	}
</style>
```

(SSR renders the desktop branch — `MediaQuery.current` is false on the server — and switches on hydration; that is acceptable.)

- [ ] **Step 2: Full-width column on mobile**

Append to the `<style>` block of `src/lib/components/Column.svelte`:

```css
	@media (max-width: 767px) {
		.column {
			width: 100%;
			min-width: 0;
		}
	}
```

- [ ] **Step 3: FilterBar horizontal scroll on mobile**

Append to the `<style>` block of `src/lib/components/FilterBar.svelte`:

```css
	@media (max-width: 767px) {
		nav {
			flex-wrap: nowrap;
			overflow-x: auto;
		}
	}
```

- [ ] **Step 4: Panel as full-screen sheet**

Append to the `<style>` block of `src/routes/(app)/task/[id]/+page.svelte`:

```css
	@media (max-width: 767px) {
		.panel {
			width: 100vw;
			border-left: 0;
		}
		.fields {
			grid-template-columns: 1fr;
		}
		select,
		input[type='date'],
		input[type='number'] {
			min-height: 44px;
		}
	}
```

- [ ] **Step 5: Verify**

`npx vitest run && npm run check && npm run build` — all clean. Browser check with `npm run dev -- --port 5175`: narrow the window below 768px → status tabs + one column, quick-add works, card click opens the full-width sheet, Escape/overlay closes; widen → 7-column board with drag & drop unchanged. Kill the dev server.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: mobile board with status tabs and full-screen task sheet"
```

---

### Task 7: Mobile e2e smoke test

**Files:**
- Create: `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: the e2e seed (`micha@e2e.test` / `e2e-password-1`), class names `.status-tabs`/`.tab` (Task 6), existing placeholders (`Add task…`, panel `Status` select).

- [ ] **Step 1: Write the test**

Create `e2e/mobile.spec.ts`:

```ts
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
	await page.getByLabel('Status').selectOption('To Do');
	await page.keyboard.press('Escape');

	// switch tab and find it there
	await page.locator('.tab', { hasText: 'To Do' }).click();
	await expect(
		page.locator('[data-column="To Do"] .card', { hasText: 'Mobile capture' })
	).toBeVisible();
});
```

- [ ] **Step 2: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: 2/2 PASS (desktop smoke + mobile). Both specs share one server/seed run; the mobile test uses its own task title, so no collision.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: mobile smoke — tabs, quick-add, panel status change"
```

---

## Post-plan verification

`npx vitest run && npm run check && npm run build && npm run test:e2e` all green, then hand-verify once on a phone-sized window against the running dev server.
