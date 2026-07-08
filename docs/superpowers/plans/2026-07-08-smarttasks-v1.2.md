# SmartTasks v1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Status-change history (who/when, visible in the panel), human-only task delete, location display on cards + panel, visible task ID, and the panel grid-blowout fix.

**Architecture:** One additive `status_events` table written by the existing task services; delete as a new service + `DELETE` endpoint + `task.deleted` SSE event; everything else is UI wiring in the existing board store, TaskCard, and detail panel.

**Tech Stack:** unchanged (SvelteKit 2 / Svelte 5 runes, Drizzle/better-sqlite3, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-07-08-smarttasks-v1.2-design.md`

## Global Constraints

- Conventions as before: services take `db` first and throw `ServiceError(status, message)`; endpoints are thin `run()`/`requireUser()` wrappers; errors are `{ "error": ... }` JSON.
- Delete: existence check first (404 `task not found`), matching the `updateTask` convention; then `user.type === 'ai'` → 403 with message exactly `AI users cannot delete tasks`; cascade (comments + status_events + task) in one transaction.
- Status events: written on create (fromStatus null) and on real status changes only (same-status patch or non-status patch writes nothing); event timestamp equals the task's `updatedAt` for that write.
- UI copy English. TDD for all server logic. Commit per task.
- A user dev server may occupy port 5173 — use `npm run dev -- --port 5175` for any manual check and kill it afterwards.

---

### Task 1: status_events schema, migration, shared type

**Files:**
- Modify: `src/lib/server/db/schema.ts`, `src/lib/types.ts`, `src/lib/server/db/db.test.ts`
- Create: new migration under `drizzle/` (generated via `npx drizzle-kit generate`)

**Interfaces:**
- Produces: table `statusEvents` (`status_events`: id PK, task_id FK NOT NULL, user_id FK NOT NULL, from_status enum nullable, to_status enum NOT NULL, created_at text NOT NULL); `StatusEventDTO = { id: number; taskId: number; userId: number; fromStatus: Status | null; toStatus: Status; createdAt: string }` from `$lib/types`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('db', ...)` in `src/lib/server/db/db.test.ts` (extend the schema import with `statusEvents`):

```ts
	it('stores status events', () => {
		const db = createDb(':memory:');
		const user = db
			.insert(users)
			.values({ name: 'M', email: 'm@t.dev', type: 'human' })
			.returning()
			.get();
		const now = new Date().toISOString();
		const task = db
			.insert(tasks)
			.values({ title: 't', createdBy: user.id, createdAt: now, updatedAt: now })
			.returning()
			.get();
		const ev = db
			.insert(statusEvents)
			.values({ taskId: task.id, userId: user.id, fromStatus: null, toStatus: 'Inbox', createdAt: now })
			.returning()
			.get();
		expect(ev.fromStatus).toBeNull();
		expect(ev.toStatus).toBe('Inbox');
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/db/db.test.ts`
Expected: FAIL — `statusEvents` not exported.

- [ ] **Step 3: Implement**

In `src/lib/server/db/schema.ts`, append after the `comments` table:

```ts
export const statusEvents = sqliteTable('status_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	taskId: integer('task_id')
		.notNull()
		.references(() => tasks.id),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	fromStatus: text('from_status', { enum: STATUSES }),
	toStatus: text('to_status', { enum: STATUSES }).notNull(),
	createdAt: text('created_at').notNull()
});
```

In `src/lib/types.ts`, append after `CommentDTO`:

```ts
export type StatusEventDTO = {
	id: number;
	taskId: number;
	userId: number;
	fromStatus: Status | null;
	toStatus: Status;
	createdAt: string;
};
```

Generate the migration: `npx drizzle-kit generate` (new file under `drizzle/`, existing ones untouched).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npm run check`
Expected: all PASS, check clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: status_events table and DTO"
```

---

### Task 2: services — status events, getTask history, deleteTask + endpoint + docs

**Files:**
- Modify: `src/lib/server/tasks-service.ts`, `src/lib/server/tasks-service.test.ts`, `src/lib/server/events.ts`, `src/routes/api/tasks/[id]/+server.ts`, `src/lib/server/api-docs.ts`

**Interfaces:**
- Consumes: `statusEvents` table + `StatusEventDTO` (Task 1); existing services/endpoints.
- Produces:
  - `createTask` writes a status event (fromStatus null → initial status, same timestamp as createdAt).
  - `updateTask` writes a status event only when the status actually changes (same timestamp as updatedAt).
  - `getTask` returns `TaskDTO & { comments: CommentDTO[]; statusEvents: StatusEventDTO[] }` (events ascending by createdAt).
  - `deleteTask(db, user, id): TaskDTO` — 404 first, then AI → 403 `AI users cannot delete tasks`; transaction deletes comments, status_events, task; returns the deleted row.
  - `TaskEvent.type` union gains `'task.deleted'`.
  - `DELETE /api/tasks/:id` → `{ ok: true }`, emits `{ type: 'task.deleted', task }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/server/tasks-service.test.ts` (extend the import from `./tasks-service` with `deleteTask`; add `import { addComment } from './comments-service';`):

```ts
describe('status events', () => {
	it('records creation and real status changes with actor and timestamps', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Track me', status: 'To Do' });
		let detail = getTask(db, t.id);
		expect(detail.statusEvents).toHaveLength(1);
		expect(detail.statusEvents[0]).toMatchObject({
			fromStatus: null,
			toStatus: 'To Do',
			userId: micha.id,
			createdAt: t.createdAt
		});

		const updated = updateTask(db, claude, t.id, { status: 'In Progress' });
		detail = getTask(db, t.id);
		expect(detail.statusEvents).toHaveLength(2);
		expect(detail.statusEvents[1]).toMatchObject({
			fromStatus: 'To Do',
			toStatus: 'In Progress',
			userId: claude.id,
			createdAt: updated.updatedAt
		});
	});

	it('writes no event for same-status or non-status patches', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Quiet' });
		updateTask(db, micha, t.id, { status: 'Inbox' });
		updateTask(db, micha, t.id, { title: 'Still quiet' });
		expect(getTask(db, t.id).statusEvents).toHaveLength(1);
	});
});

describe('deleteTask', () => {
	it('cascades comments and events, humans only, 404 on missing', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const t = createTask(db, micha, { title: 'Doomed' });
		addComment(db, micha, t.id, 'bye');
		updateTask(db, micha, t.id, { status: 'Done' });
		expect(() => deleteTask(db, claude, t.id)).toThrowError('AI users cannot delete tasks');
		const deleted = deleteTask(db, micha, t.id);
		expect(deleted.id).toBe(t.id);
		expect(() => getTask(db, t.id)).toThrowError('task not found');
		expect(() => deleteTask(db, micha, t.id)).toThrowError('task not found');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/tasks-service.test.ts`
Expected: FAIL — `statusEvents` missing from getTask, `deleteTask` not exported.

- [ ] **Step 3: Implement in `src/lib/server/tasks-service.ts`**

1. Extend the schema import to `import { tasks, users, comments, projects, statusEvents } from './db/schema';` and the types import with `StatusEventDTO`.
2. In `createTask`, after the insert (the function currently ends with `.returning().get();`), capture the row and record the event:

```ts
	const task = db
		.insert(tasks)
		.values({
			/* …existing values object stays byte-identical… */
		})
		.returning()
		.get();
	db.insert(statusEvents)
		.values({ taskId: task.id, userId: user.id, fromStatus: null, toStatus: task.status, createdAt: now })
		.run();
	return task;
```

3. In `updateTask`, replace the inline timestamps with one `const now = new Date().toISOString();` right after the title check, use it for `updatedAt` and `completedAt`, and record the change after the update:

```ts
	const now = new Date().toISOString();
	const next: Record<string, unknown> = { updatedAt: now };
	for (const key of UPDATABLE) {
		if (key in patch) next[key] = patch[key];
	}
	const statusChanged = !!patch.status && patch.status !== existing.status;
	if (statusChanged) {
		next.completedAt = patch.status === 'Done' ? now : null;
	}
	const task = db.update(tasks).set(next).where(eq(tasks.id, id)).returning().get();
	if (statusChanged)
		db.insert(statusEvents)
			.values({ taskId: id, userId: user.id, fromStatus: existing.status, toStatus: patch.status!, createdAt: now })
			.run();
	return task;
```

4. In `getTask`, add the events and extend the return type to `TaskDTO & { comments: CommentDTO[]; statusEvents: StatusEventDTO[] }`:

```ts
	const events = db
		.select()
		.from(statusEvents)
		.where(eq(statusEvents.taskId, id))
		.orderBy(asc(statusEvents.createdAt))
		.all();
	return { ...task, comments: taskComments, statusEvents: events };
```

5. Append `deleteTask`:

```ts
export function deleteTask(db: Db, user: SafeUser, id: number): TaskDTO {
	const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
	if (!existing) throw new ServiceError(404, 'task not found');
	if (user.type === 'ai') throw new ServiceError(403, 'AI users cannot delete tasks');
	db.transaction((tx) => {
		tx.delete(comments).where(eq(comments.taskId, id)).run();
		tx.delete(statusEvents).where(eq(statusEvents.taskId, id)).run();
		tx.delete(tasks).where(eq(tasks.id, id)).run();
	});
	return existing;
}
```

- [ ] **Step 4: Wire the event type, endpoint, and docs**

In `src/lib/server/events.ts`, change the type union to:

```ts
	type: 'task.created' | 'task.updated' | 'comment.created' | 'task.deleted';
```

In `src/routes/api/tasks/[id]/+server.ts`, extend the service import with `deleteTask` and append:

```ts
export const DELETE: RequestHandler = ({ locals, params }) =>
	run(() => {
		const user = requireUser(locals);
		const task = deleteTask(db, user, Number(params.id));
		emit({ type: 'task.deleted', task });
		return json({ ok: true });
	});
```

In `src/lib/server/api-docs.ts`:
- Change the `GET /api/tasks/:id` row description to `Detail incl. comments and statusEvents (status history: who set which status when)`.
- Insert a new table row after the PATCH row: `| DELETE /api/tasks/:id | Delete a task incl. comments and history — human users only (403 for AI) |`
- In the "Workflow for AI agents" section, append a step: `6. Reference tasks as \`#<id>\` when communicating with humans — the id is shown in the UI.`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npm run check`
Expected: all PASS, check clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: status history, human-only task delete, task.deleted event"
```

---

### Task 3: UI — store delete/SSE, location badge, panel (id, location, history, delete, width fix)

**Files:**
- Modify: `src/lib/client/board.svelte.ts`, `src/lib/components/TaskCard.svelte`, `src/routes/(app)/task/[id]/+page.svelte`

**Interfaces:**
- Consumes: `DELETE /api/tasks/:id`, `task.deleted` SSE event, `statusEvents` in the detail payload, `StatusEventDTO`, `board.locations`/`board.projects`.
- Produces: `board.remove(id: number)`, `board.deleteTask(id: number): Promise<boolean>`; SSE handler removes on `task.deleted`. Task 4's e2e relies on: panel `.task-id` text `#<id>`, `.history` lines containing `→ <status>`, a button with text `Delete task` that becomes `Really delete?`.

- [ ] **Step 1: Extend the board store**

In `src/lib/client/board.svelte.ts`:

1. Replace the SSE `onmessage` body's inner logic with:

```ts
				const e = JSON.parse(m.data);
				if (e.type === 'task.deleted' && e.task) this.remove(e.task.id);
				else if (e.task) this.upsert(e.task, { flash: true });
```

2. Add the two methods (after `patchTask`):

```ts
	remove(id: number) {
		this.tasks = this.tasks.filter((t) => t.id !== id);
	}

	async deleteTask(id: number): Promise<boolean> {
		try {
			await api<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' });
			this.remove(id);
			return true;
		} catch (e) {
			this.toast((e as Error).message);
			return false;
		}
	}
```

- [ ] **Step 2: Location badge on cards**

In `src/lib/components/TaskCard.svelte`, add below the existing `project` derivation:

```ts
	const location = $derived(
		project ? board.locations.find((l) => l.id === project.locationId) : undefined
	);
```

and in the markup, directly after the project badge line, add:

```svelte
		{#if location}<span class="badge">{location.name}</span>{/if}
```

- [ ] **Step 3: Panel — ID, location field, history, delete, width fixes**

In `src/routes/(app)/task/[id]/+page.svelte`:

1. Extend the types import with `StatusEventDTO` and change the Detail type to:

```ts
	type Detail = TaskDTO & { comments: CommentDTO[]; statusEvents: StatusEventDTO[] };
```

2. Add state + derivation in the script (near `editingDescription`):

```ts
	let confirmDelete = $state(false);

	const locationName = $derived.by(() => {
		const project = board.projects.find((p) => p.id === detail?.projectId);
		const loc = project ? board.locations.find((l) => l.id === project.locationId) : undefined;
		return loc?.name ?? '—';
	});
```

and reset the confirm state when the task changes — in the existing `$effect`, directly after `detail = null;`, add `confirmDelete = false;`.

3. In the header, insert the ID before the title input:

```svelte
			<span class="task-id">#{detail.id}</span>
```

4. In the fields grid, after the Project label/select block, add:

```svelte
			<label>Location
				<input type="text" value={locationName} readonly tabindex="-1" />
			</label>
```

5. Replace the footer block with history + delete:

```svelte
		<footer class="meta">
			<div>Created by {userName(detail.createdBy)} · {fmt(detail.createdAt)}</div>
			<div class="history">
				{#each detail.statusEvents as ev (ev.id)}
					<div>
						{ev.fromStatus ? `${ev.fromStatus} → ` : '→ '}{ev.toStatus} · {userName(ev.userId)} · {fmt(ev.createdAt)}
					</div>
				{/each}
			</div>
			<button
				class="delete"
				onclick={async () => {
					if (!confirmDelete) {
						confirmDelete = true;
						return;
					}
					if (await board.deleteTask(id)) close();
				}}
			>
				{confirmDelete ? 'Really delete?' : 'Delete task'}
			</button>
		</footer>
```

(The former `{#if detail.completedAt} · Completed …{/if}` display is removed — completion is now the last history line.)

6. Style changes in the `<style>` block:

- Change `.fields` to `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);`
- Extend the `select, input[type='date'], input[type='number']` rule with `max-width: 100%;` and add `width: 100%;`
- Change `.title` to include `min-width: 0;`
- Extend `.rendered` with `overflow-wrap: anywhere;` and add the same to `.comments article`.
- Append:

```css
	.task-id {
		color: var(--muted);
		font-size: 13px;
		white-space: nowrap;
	}
	input[readonly] {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--muted);
	}
	.meta {
		display: grid;
		gap: 6px;
		justify-items: start;
	}
	.history {
		display: grid;
		gap: 2px;
	}
	.delete {
		border: 0;
		background: none;
		color: var(--danger);
		cursor: pointer;
		padding: 0;
		font-size: 12px;
	}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run check && npm run build`
Expected: all green. Manual sanity check (optional given Task 4's e2e): `DATABASE_PATH=data/dev.db npm run dev -- --port 5175`, open a task — no horizontal scroll despite long project options; `#<id>` in the header; Location field filled for a project with location; history lines under Created; Delete → Really delete? → card disappears. Kill the server.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: task id, location display, status history, delete UI, panel width fix"
```

---

### Task 4: E2E — history + delete flow

**Files:**
- Modify: `e2e/board.spec.ts`

**Interfaces:**
- Consumes: `.task-id`, `.history`, `Delete task`/`Really delete?` button (Task 3); existing desktop smoke flow (task "Order the wood" is moved to In Progress via the panel Status select and later commented).

- [ ] **Step 1: Extend the desktop spec**

In `e2e/board.spec.ts`, inside the existing test after the comment assertions (the `getByText('Micha ·')` expectation), append:

```ts
	// status history is visible with actor
	await expect(page.locator('.task-id')).toHaveText(/#\d+/);
	await expect(page.locator('.history').getByText('→ In Progress')).toBeVisible();

	// delete: two-step confirm, card disappears
	await page.getByRole('button', { name: 'Delete task' }).click();
	await page.getByRole('button', { name: 'Really delete?' }).click();
	await expect(page.locator('.card', { hasText: 'Order the wood' })).toHaveCount(0);
```

- [ ] **Step 2: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: 2/2 PASS (the mobile spec is untouched; it uses its own task).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: e2e covers status history and delete flow"
```

---

## Post-plan verification

`npx vitest run && npm run check && npm run build && npm run test:e2e` all green; then deploy via `ssh deploy@labs.remoterepublic.com '/opt/smarttasks/scripts/deploy-vps.sh'` (the new migration applies automatically at service restart).
