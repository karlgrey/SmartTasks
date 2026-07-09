# Photo Attachments (v1.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photos attach to tasks; gallery in the detail panel; the board loads zero image bytes.

**Architecture:** Files on disk under `<dirname(DATABASE_PATH)>/uploads/` named `<id>.<ext>`; an `attachments` table holds metadata; auth-guarded endpoints upload/serve/delete; the browser downscales to ≤1600px JPEG before upload (no server-side image processing).

**Tech Stack:** SvelteKit + better-sqlite3/Drizzle (existing). No new dependencies.

## Global Constraints

- Board view unchanged: no TaskDTO change, no extra queries, no image bytes (spec).
- Upload/delete: humans only; AI users → 403. Read (GET) allowed for any authenticated user (spec).
- Server-side file limit 5 MB; accepted mimes `image/jpeg`, `image/png`, `image/webp` (spec).
- Client downscale: longest edge ≤1600px, JPEG quality 0.8 (spec).
- Follow existing patterns: `ServiceError`, `run()/requireUser()`, service-layer tests with `testDb()/seedUsers()`.
- Deploy note: adapter-node's `BODY_SIZE_LIMIT` defaults to 512K — prod needs `BODY_SIZE_LIMIT=6M` (systemd override) at deploy time; backup cron gains the uploads dir.

---

### Task 1: Data model — `attachments` table, migration, DTO

**Files:**
- Modify: `src/lib/server/db/schema.ts` (append table)
- Modify: `src/lib/types.ts` (append DTO)
- Create: `drizzle/0003_*.sql` (generated)
- Test: `src/lib/server/db/db.test.ts` (existing migration test covers new table implicitly; explicit insert test in Task 2)

**Interfaces:**
- Produces: `attachments` Drizzle table (`taskId`, `filename`, `mime`, `size`, `createdBy`, `createdAt`); `AttachmentDTO = { id, taskId, filename, mime, size, createdBy, createdAt }`.

- [ ] **Step 1: Add table to schema**

Append to `src/lib/server/db/schema.ts`:

```ts
export const attachments = sqliteTable('attachments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	taskId: integer('task_id')
		.notNull()
		.references(() => tasks.id),
	filename: text('filename').notNull(),
	mime: text('mime').notNull(),
	size: integer('size').notNull(),
	createdBy: integer('created_by')
		.notNull()
		.references(() => users.id),
	createdAt: text('created_at').notNull()
});
```

- [ ] **Step 2: Add DTO**

Append to `src/lib/types.ts`:

```ts
export type AttachmentDTO = {
	id: number;
	taskId: number;
	filename: string;
	mime: string;
	size: number; // bytes as stored
	createdBy: number;
	createdAt: string;
};
```

- [ ] **Step 3: Generate migration**

Run: `npx drizzle-kit generate --name attachments`
Expected: new `drizzle/0003_attachments.sql` with `CREATE TABLE attachments …`

- [ ] **Step 4: Verify existing tests still pass (migration applies)**

Run: `npm run test:unit`
Expected: all green (createDb runs migrations, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db/schema.ts src/lib/types.ts drizzle/
git commit -m "feat: attachments table + AttachmentDTO"
```

### Task 2: attachments-service (add/list/get/delete + file storage)

**Files:**
- Create: `src/lib/server/attachments-service.ts`
- Create: `src/lib/server/attachments-service.test.ts`

**Interfaces:**
- Consumes: `attachments` table (Task 1), `ServiceError`, `SafeUser`, `Db`.
- Produces:
  - `uploadsDir(): string` — `<dirname(DATABASE_PATH ?? 'data/smarttasks.db')>/uploads`
  - `attachmentPath(a: { id: number; mime: string }, dir: string): string`
  - `addAttachment(db, user, taskId, file: { filename: string; mime: string; data: Buffer }, dir): AttachmentDTO`
  - `getAttachment(db, id): AttachmentDTO` (404 if missing)
  - `deleteAttachment(db, user, id, dir): AttachmentDTO`
  - `deleteTaskAttachments(db, taskId, dir): void` (rows + files; used by deleteTask in Task 3)

- [ ] **Step 1: Write failing tests**

`src/lib/server/attachments-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb, seedUsers } from './test-utils';
import { createTask } from './tasks-service';
import {
	addAttachment,
	getAttachment,
	deleteAttachment,
	deleteTaskAttachments,
	attachmentPath
} from './attachments-service';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('attachments-service', () => {
	let db: ReturnType<typeof testDb>;
	let users: ReturnType<typeof seedUsers>;
	let dir: string;
	let taskId: number;

	beforeEach(() => {
		db = testDb();
		users = seedUsers(db);
		dir = mkdtempSync(join(tmpdir(), 'st-uploads-'));
		taskId = createTask(db, users.micha, { title: 'T' }).id;
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('stores file + row and serves metadata', () => {
		const a = addAttachment(db, users.micha, taskId, { filename: 'p.png', mime: 'image/png', data: png }, dir);
		expect(a.taskId).toBe(taskId);
		expect(a.size).toBe(png.length);
		expect(existsSync(attachmentPath(a, dir))).toBe(true);
		expect(getAttachment(db, a.id)).toEqual(a);
	});

	it('rejects AI users', () => {
		expect(() =>
			addAttachment(db, users.claude, taskId, { filename: 'p.png', mime: 'image/png', data: png }, dir)
		).toThrowError(/403|AI users/);
	});

	it('rejects unknown task, bad mime, oversize, empty file', () => {
		const f = { filename: 'p.png', mime: 'image/png', data: png };
		expect(() => addAttachment(db, users.micha, 999, f, dir)).toThrowError(/task not found/);
		expect(() =>
			addAttachment(db, users.micha, taskId, { ...f, mime: 'application/pdf' }, dir)
		).toThrowError(/unsupported/);
		expect(() =>
			addAttachment(db, users.micha, taskId, { ...f, data: Buffer.alloc(5 * 1024 * 1024 + 1) }, dir)
		).toThrowError(/too large/);
		expect(() => addAttachment(db, users.micha, taskId, { ...f, data: Buffer.alloc(0) }, dir)).toThrowError(
			/empty/
		);
	});

	it('deleteAttachment removes row + file, humans only', () => {
		const a = addAttachment(db, users.micha, taskId, { filename: 'p.png', mime: 'image/png', data: png }, dir);
		expect(() => deleteAttachment(db, users.claude, a.id, dir)).toThrowError(/403|AI users/);
		deleteAttachment(db, users.micha, a.id, dir);
		expect(() => getAttachment(db, a.id)).toThrowError(/not found/);
		expect(existsSync(attachmentPath(a, dir))).toBe(false);
	});

	it('deleteTaskAttachments removes all rows + files for a task', () => {
		const a1 = addAttachment(db, users.micha, taskId, { filename: 'a.png', mime: 'image/png', data: png }, dir);
		const a2 = addAttachment(db, users.micha, taskId, { filename: 'b.jpg', mime: 'image/jpeg', data: png }, dir);
		deleteTaskAttachments(db, taskId, dir);
		expect(() => getAttachment(db, a1.id)).toThrowError(/not found/);
		expect(existsSync(attachmentPath(a2, dir))).toBe(false);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/server/attachments-service.test.ts`
Expected: FAIL — module `./attachments-service` not found

- [ ] **Step 3: Implement**

`src/lib/server/attachments-service.ts`:

```ts
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, attachments } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import type { AttachmentDTO } from '$lib/types';

const MAX_SIZE = 5 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function uploadsDir(): string {
	return join(dirname(process.env.DATABASE_PATH ?? 'data/smarttasks.db'), 'uploads');
}

export function attachmentPath(a: { id: number; mime: string }, dir: string): string {
	return join(dir, `${a.id}.${EXT[a.mime]}`);
}

export type AttachmentFile = { filename: string; mime: string; data: Buffer };

export function addAttachment(
	db: Db,
	user: SafeUser,
	taskId: number,
	file: AttachmentFile,
	dir: string
): AttachmentDTO {
	if (user.type === 'ai') throw new ServiceError(403, 'AI users cannot upload attachments');
	if (!EXT[file.mime])
		throw new ServiceError(400, `unsupported image type: must be one of ${Object.keys(EXT).join(', ')}`);
	if (file.data.length === 0) throw new ServiceError(400, 'file is empty');
	if (file.data.length > MAX_SIZE) throw new ServiceError(400, 'file too large (max 5 MB)');
	if (!db.select().from(tasks).where(eq(tasks.id, taskId)).get())
		throw new ServiceError(404, 'task not found');
	const row = db
		.insert(attachments)
		.values({
			taskId,
			filename: file.filename || 'photo.jpg',
			mime: file.mime,
			size: file.data.length,
			createdBy: user.id,
			createdAt: new Date().toISOString()
		})
		.returning()
		.get();
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(attachmentPath(row, dir), file.data);
	} catch (e) {
		db.delete(attachments).where(eq(attachments.id, row.id)).run();
		throw e;
	}
	return row;
}

export function getAttachment(db: Db, id: number): AttachmentDTO {
	const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
	if (!row) throw new ServiceError(404, 'attachment not found');
	return row;
}

export function deleteAttachment(db: Db, user: SafeUser, id: number, dir: string): AttachmentDTO {
	if (user.type === 'ai') throw new ServiceError(403, 'AI users cannot delete attachments');
	const row = getAttachment(db, id);
	db.delete(attachments).where(eq(attachments.id, id)).run();
	rmSync(attachmentPath(row, dir), { force: true });
	return row;
}

export function deleteTaskAttachments(db: Db, taskId: number, dir: string): void {
	const rows = db.select().from(attachments).where(eq(attachments.taskId, taskId)).all();
	db.delete(attachments).where(eq(attachments.taskId, taskId)).run();
	for (const row of rows) rmSync(attachmentPath(row, dir), { force: true });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/server/attachments-service.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/attachments-service.ts src/lib/server/attachments-service.test.ts
git commit -m "feat: attachments service (store/list/delete photos on disk)"
```

### Task 3: getTask includes attachments; deleteTask cleans up files

**Files:**
- Modify: `src/lib/server/tasks-service.ts` (`getTask`, `deleteTask`)
- Test: `src/lib/server/tasks-service.test.ts` (append)

**Interfaces:**
- Consumes: `deleteTaskAttachments`, `attachmentPath`, `uploadsDir` (Task 2).
- Produces: `getTask` return type gains `attachments: AttachmentDTO[]`; `deleteTask(db, user, id, uploadsPath = uploadsDir())`.

- [ ] **Step 1: Write failing tests** (append to `tasks-service.test.ts`)

```ts
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addAttachment, attachmentPath } from './attachments-service';

// inside the existing describe/setup that provides db + users:
it('getTask includes attachments; deleteTask removes their files', () => {
	const dir = mkdtempSync(join(tmpdir(), 'st-uploads-'));
	const task = createTask(db, micha, { title: 'with photo' });
	const a = addAttachment(
		db, micha, task.id,
		{ filename: 'p.png', mime: 'image/png', data: Buffer.from([1, 2, 3]) },
		dir
	);
	expect(getTask(db, task.id).attachments).toEqual([a]);
	deleteTask(db, micha, task.id, dir);
	expect(existsSync(attachmentPath(a, dir))).toBe(false);
	expect(() => getTask(db, task.id)).toThrowError(/not found/);
});
```

(Adapt variable names to the file's existing setup — it seeds `micha`/`claude` via `seedUsers`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/server/tasks-service.test.ts`
Expected: FAIL — `attachments` not on getTask result / deleteTask has no 4th param

- [ ] **Step 3: Implement**

In `getTask`, query and return attachments (ordered by id):

```ts
const taskAttachments = db
	.select()
	.from(attachments)
	.where(eq(attachments.taskId, id))
	.orderBy(asc(attachments.id))
	.all();
return { ...task, comments: taskComments, statusEvents: events, attachments: taskAttachments };
```

Return type: `TaskDTO & { comments: CommentDTO[]; statusEvents: StatusEventDTO[]; attachments: AttachmentDTO[] }`. Import `attachments` from schema, `AttachmentDTO` from types, `deleteTaskAttachments`/`uploadsDir` from `./attachments-service`.

In `deleteTask`, add param and cleanup (files removed after the row tx, best-effort):

```ts
export function deleteTask(db: Db, user: SafeUser, id: number, uploadsPath = uploadsDir()): TaskDTO {
	const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
	if (!existing) throw new ServiceError(404, 'task not found');
	if (user.type === 'ai') throw new ServiceError(403, 'AI users cannot delete tasks');
	db.transaction((tx) => {
		tx.delete(comments).where(eq(comments.taskId, id)).run();
		tx.delete(statusEvents).where(eq(statusEvents.taskId, id)).run();
		tx.delete(tasks).where(eq(tasks.id, id)).run();
	});
	deleteTaskAttachments(db, id, uploadsPath);
	return existing;
}
```

Note: `deleteTaskAttachments` deletes attachment rows itself, so they must NOT also be deleted inside the tx (FK order: attachments reference tasks, so delete attachments rows BEFORE the task row — move `deleteTaskAttachments` call above the transaction).

Corrected order:

```ts
	deleteTaskAttachments(db, id, uploadsPath);
	db.transaction((tx) => { /* comments, statusEvents, tasks as before */ });
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: PASS (all suites)

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tasks-service.ts src/lib/server/tasks-service.test.ts
git commit -m "feat: task detail lists attachments; task delete cleans up photo files"
```

### Task 4: API endpoints (upload / serve / delete)

**Files:**
- Create: `src/routes/api/tasks/[id]/attachments/+server.ts`
- Create: `src/routes/api/attachments/[id]/+server.ts`
- Modify: `src/lib/server/api-docs.ts` (one-paragraph note)

**Interfaces:**
- Consumes: Task 2 service functions; `run`/`requireUser`; `db`.
- Produces: `POST /api/tasks/:id/attachments` (multipart field `file`) → 201 AttachmentDTO; `GET /api/attachments/:id` → image bytes; `DELETE /api/attachments/:id` → `{ ok: true }`.

- [ ] **Step 1: Implement upload route**

`src/routes/api/tasks/[id]/attachments/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { ServiceError } from '$lib/server/errors';
import { addAttachment, uploadsDir } from '$lib/server/attachments-service';

export const POST: RequestHandler = ({ locals, params, request }) =>
	run(async () => {
		const user = requireUser(locals);
		const form = await request.formData().catch(() => null);
		const file = form?.get('file');
		if (!(file instanceof File)) throw new ServiceError(400, 'multipart field "file" is required');
		const attachment = addAttachment(
			db,
			user,
			Number(params.id),
			{ filename: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) },
			uploadsDir()
		);
		return json(attachment, { status: 201 });
	});
```

- [ ] **Step 2: Implement serve + delete route**

`src/routes/api/attachments/[id]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { run, requireUser } from '$lib/server/api-utils';
import { ServiceError } from '$lib/server/errors';
import { getAttachment, deleteAttachment, attachmentPath, uploadsDir } from '$lib/server/attachments-service';

export const GET: RequestHandler = ({ locals, params }) =>
	run(() => {
		requireUser(locals);
		const attachment = getAttachment(db, Number(params.id));
		let data: Buffer;
		try {
			data = readFileSync(attachmentPath(attachment, uploadsDir()));
		} catch {
			throw new ServiceError(404, 'attachment file missing');
		}
		return new Response(new Uint8Array(data), {
			headers: {
				'content-type': attachment.mime,
				'content-length': String(data.length),
				// content is immutable: replacing a photo creates a new id
				'cache-control': 'private, max-age=31536000, immutable'
			}
		});
	});

export const DELETE: RequestHandler = ({ locals, params }) =>
	run(() => {
		const user = requireUser(locals);
		deleteAttachment(db, user, Number(params.id), uploadsDir());
		return json({ ok: true });
	});
```

- [ ] **Step 3: Document in /api/docs**

In `src/lib/server/api-docs.ts`, add under the task endpoints section:

```
### Attachments (photos)
Tasks can carry photo attachments. They are listed in `GET /api/tasks/:id`
under `attachments` (id, filename, mime, size, createdBy, createdAt) and each
file is served at `GET /api/attachments/:id`. Upload and delete are
**human/web-UI only** — AI users receive 403.
```

(Match the file's existing formatting/style; exact placement: alongside the comments endpoint docs.)

- [ ] **Step 4: Typecheck**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/tasks/[id]/attachments src/routes/api/attachments src/lib/server/api-docs.ts
git commit -m "feat: attachment API — upload, auth-guarded serving, delete"
```

### Task 5: Client — downscale util + Photos section in detail panel

**Files:**
- Create: `src/lib/client/image.ts`
- Modify: `src/routes/(app)/task/[id]/+page.svelte`

**Interfaces:**
- Consumes: `AttachmentDTO`; endpoints from Task 4; `board.toast`; `api()` for DELETE.
- Produces: `downscaleImage(file: File, maxEdge?: number): Promise<Blob>`; Photos section between description and comments.

- [ ] **Step 1: Downscale util**

`src/lib/client/image.ts` (browser-only — canvas; covered by e2e, not unit-testable in node):

```ts
/** Downscale to maxEdge px (longest side) and re-encode as JPEG q0.8.
 *  Side effect by design: strips EXIF (incl. GPS). */
export async function downscaleImage(file: File, maxEdge = 1600): Promise<Blob> {
	const bitmap = await createImageBitmap(file).catch(() => {
		throw new Error(`${file.name}: not a supported image`);
	});
	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
	if (!blob) throw new Error('image conversion failed');
	return blob;
}
```

- [ ] **Step 2: Wire into the panel**

In `src/routes/(app)/task/[id]/+page.svelte`:

Script additions:

```ts
import { downscaleImage } from '$lib/client/image';
import type { AttachmentDTO } from '$lib/types';
// Detail type gains attachments:
type Detail = TaskDTO & { comments: CommentDTO[]; statusEvents: StatusEventDTO[]; attachments: AttachmentDTO[] };

let confirmPhotoDelete = $state<number | null>(null);

async function uploadPhotos(e: Event) {
	const input = e.currentTarget as HTMLInputElement;
	const files = [...(input.files ?? [])];
	input.value = '';
	for (const f of files) {
		try {
			const blob = await downscaleImage(f);
			const form = new FormData();
			form.append('file', blob, f.name.replace(/\.[^.]*$/, '') + '.jpg');
			const res = await fetch(`/api/tasks/${id}/attachments`, { method: 'POST', body: form });
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
			detail?.attachments.push(await res.json());
		} catch (err) {
			board.toast((err as Error).message);
		}
	}
}

async function removePhoto(attId: number) {
	if (confirmPhotoDelete !== attId) {
		confirmPhotoDelete = attId;
		return;
	}
	confirmPhotoDelete = null;
	try {
		await api(`/api/attachments/${attId}`, { method: 'DELETE' });
		if (detail) detail.attachments = detail.attachments.filter((a) => a.id !== attId);
	} catch (err) {
		board.toast((err as Error).message);
	}
}
```

Markup — insert between `</section>` of description and `<section class="comments">`:

```svelte
<section class="photos">
	<h3>Photos</h3>
	<div class="strip">
		{#each detail.attachments as a (a.id)}
			<div class="thumb">
				<a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">
					<img src={`/api/attachments/${a.id}`} alt={a.filename} loading="lazy" />
				</a>
				<button
					class="remove"
					aria-label="Delete photo"
					onclick={() => removePhoto(a.id)}
				>{confirmPhotoDelete === a.id ? 'Del?' : '×'}</button>
			</div>
		{/each}
		<label class="add" aria-label="Add photos">
			+
			<input type="file" accept="image/*" multiple hidden onchange={uploadPhotos} />
		</label>
	</div>
</section>
```

Styles (append to the page's `<style>`; mirror the comments section's `h3` treatment):

```css
.photos .strip {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.thumb {
	position: relative;
	width: 72px;
	height: 72px;
}
.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	border-radius: 6px;
	border: 1px solid var(--border);
	display: block;
}
.thumb .remove {
	position: absolute;
	top: -6px;
	right: -6px;
	border: 1px solid var(--border);
	background: var(--surface);
	border-radius: 50%;
	min-width: 20px;
	height: 20px;
	font-size: 11px;
	line-height: 1;
	cursor: pointer;
	color: var(--muted);
	padding: 0 4px;
}
.add {
	width: 72px;
	height: 72px;
	display: grid;
	place-items: center;
	border: 1px dashed var(--border);
	border-radius: 6px;
	font-size: 22px;
	color: var(--muted);
	cursor: pointer;
}
```

(Check what `.comments h3` looks like and reuse; if `h3` styling is section-scoped, duplicate it for `.photos h3`.)

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/client/image.ts "src/routes/(app)/task/[id]/+page.svelte"
git commit -m "feat: photo gallery in task detail — client-side downscale, upload, delete"
```

### Task 6: E2E test + ops notes

**Files:**
- Create: `e2e/photos.spec.ts`
- Modify: `README.md` (deploy/ops notes: BODY_SIZE_LIMIT, backup)

**Interfaces:**
- Consumes: full stack from Tasks 1–5; existing e2e login pattern from `e2e/board.spec.ts`.

- [ ] **Step 1: Write e2e test**

`e2e/photos.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e`
Expected: PASS (both spec files; webServer builds and seeds `.e2e/test.db`, uploads land in `.e2e/uploads/`)

- [ ] **Step 3: README ops notes**

Add to the deploy/ops section of `README.md`:

```markdown
### Photo attachments (v1.3)
- Files live in `<dirname(DATABASE_PATH)>/uploads/` (prod: `/opt/smarttasks/data/uploads/`).
- adapter-node caps request bodies at 512K by default — production needs
  `BODY_SIZE_LIMIT=6M` in the systemd unit (matches the server-side 5 MB limit).
- The nightly backup must include the uploads dir alongside the sqlite file.
```

- [ ] **Step 4: Full verification**

Run: `npm run check && npm run test:unit && npm run test:e2e`
Expected: all green

- [ ] **Step 5: Commit**

```bash
git add e2e/photos.spec.ts README.md
git commit -m "test: e2e photo upload flow; docs: ops notes for uploads"
```

### Deploy checklist (manual, at release)

1. `ssh deploy@labs.remoterepublic.com`, then:
   - `sudo systemctl edit smarttasks` → add `[Service]` / `Environment=BODY_SIZE_LIMIT=6M`
   - extend the backup cron to also archive `/opt/smarttasks/data/uploads/` (same 14-day rotation)
2. Push main, run `/opt/smarttasks/scripts/deploy-vps.sh` (daemon-reload happens via restart? No — `sudo systemctl daemon-reload` is needed after the unit edit, then deploy).
3. Smoke test on the phone: open a task → add photo via camera → thumbnail appears; check `data/uploads/` on the server.
