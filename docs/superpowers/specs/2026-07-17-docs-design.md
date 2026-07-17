# SmartTasks v1.4 — Docs (Markdown documents)

**Date:** 2026-07-17
**Status:** Ready for review (branch `docs-v1`, not deployed)
**Ticket:** #212
**Builds on:** v1.3 (photo attachments, shipped)

## Purpose

A first-class **Document** entity: Markdown notes that live next to tasks
(SOPs, briefs, meeting notes, reference material). Docs can be created and
edited by humans and AI agents, over both the web UI and the REST API, and can
be linked many-to-many with tasks so context travels with the work.

Decisions made during scoping (Micha, 17.07.2026):

- Docs are their **own entity**, not attached to a single task (n:m link).
- **Humans and AI** may create/edit (same as tasks). **DELETE is human-only**
  (AI → 403, exactly like task delete).
- Editor stays **simple**: a textarea with a live Markdown preview, reusing the
  existing `renderMarkdown` (marked + DOMPurify) already used for task
  descriptions and comments. No rich-text editor.
- Search over **title + body** with SQL `LIKE` (SQLite scale; no FTS in the repo
  today, so none added — mirrors the task search).

## Naming / route decisions (important)

`GET /api/docs` **already exists** — it serves the human/agent API guide
(`src/lib/server/api-docs.ts`). To avoid a collision the new REST resource is
mounted at **`/api/documents`**, and the UI at **`/docs`**. So:

- REST: `/api/documents`, `/api/documents/:id`, plus link endpoints (below).
- UI: `/docs` (list), `/docs/new` (create), `/docs/:id` (view/edit).

The UI path `/docs` does not clash with any API route (`/api/docs` is under
`/api`). The word "docs" therefore means the API-guide only under `/api`, and
the document feature everywhere else.

## Data model

### documents (new)
| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| title | text NOT NULL | |
| body | text NOT NULL default '' | Markdown source |
| project_id | FK projects, nullable | optional project association |
| created_by | FK users NOT NULL | |
| created_at | text NOT NULL | ISO string |
| updated_at | text NOT NULL | ISO string |

### document_tasks (new, n:m)
| Column | Type | Notes |
|---|---|---|
| document_id | FK documents NOT NULL | |
| task_id | FK tasks NOT NULL | |
| composite PK (document_id, task_id) | | idempotent linking |

One additive Drizzle migration (`0004_documents`). No change to existing tables.

DTOs (`src/lib/types.ts`):
- `DocumentDTO` = { id, title, body, projectId, createdBy, createdAt, updatedAt }
- `TaskRefDTO` = { id, title, status } — linked tasks on a doc detail
- `DocRefDTO` = { id, title } — linked docs on a task detail

`getTask` detail response gains `documents: DocRefDTO[]`. `getDocument` detail
returns `DocumentDTO & { tasks: TaskRefDTO[] }`. Board TaskDTO is unchanged
(board speed guarantee from v1.3 preserved — docs never touch the board).

## API

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/documents` | GET | session or bearer | list; query: `project` (id), `q` (LIKE over title+body), `limit`, `offset`; newest-updated first |
| `/api/documents` | POST | session or bearer (human+AI) | create {title, body?, projectId?} → 201 DocumentDTO |
| `/api/documents/:id` | GET | session or bearer | DocumentDTO + `tasks: TaskRefDTO[]` |
| `/api/documents/:id` | PATCH | session or bearer (human+AI) | partial update {title?, body?, projectId?} |
| `/api/documents/:id` | DELETE | session, **human only** (AI → 403) | removes doc + its link rows |
| `/api/documents/:id/tasks` | POST | session or bearer (human+AI) | link {taskId} (idempotent) → 201 |
| `/api/documents/:id/tasks/:taskId` | DELETE | session or bearer (human+AI) | unlink |
| `/api/tasks/:id/documents` | POST | session or bearer (human+AI) | reciprocal link {documentId} |
| `/api/tasks/:id/documents/:documentId` | DELETE | session or bearer (human+AI) | reciprocal unlink |

Reciprocal link endpoints exist because both the doc UI and the task UI need to
link, and each side naturally knows only its own id. Both call the same
`linkTask` / `unlinkTask` service. Linking counts as *editing* an association,
so it follows the create/edit permission (human + AI), not the delete rule —
unlinking never destroys a doc or a task.

`/api/docs` (the guide) gains a short Documents section.

## Client (UI)

Docs live **outside the `(app)` route group** so they don't render the kanban
board underneath. New top-level `src/routes/docs/` with its own
`+layout.server.ts` (auth redirect, provides `user`, `projects`, `users`) and a
light `+layout.svelte` header (brand, back-to-board link).

- **`/docs`** (`+page.server.ts` load, SSR): list of docs (title, project chip,
  updated date). Project `<select>` filter and a search `<input>` — both driven
  by URL params (`?project=`, `?q=`) exactly like the board's FilterBar, so the
  server load re-runs and search hits title+body server-side. "New document"
  button → `/docs/new`.
- **`/docs/new`**: title + body form → `POST /api/documents` → navigate to
  `/docs/:id`.
- **`/docs/:id`**: doc fetched **client-side** via `/api/documents/:id` (same
  pattern as the task detail panel — keeps `renderMarkdown`/DOMPurify off the
  server, since DOMPurify needs a DOM). Shows title, project chip, meta
  (creator, updated), rendered Markdown with an edit toggle (textarea + live
  preview), a linked-tasks list with a simple picker to add/remove links, and a
  two-step Delete (human-only; the button is hidden for AI users).
- **Board → Docs**: a "Docs" link added to the board's top nav (FilterBar) so
  the feature is reachable.
- **Task detail**: a "Docs" section listing linked documents (links to
  `/docs/:id`) with a simple picker to link/unlink.

## Search in the global (board) search — decision

The board's "global" search is a **client-side filter over already-loaded
tasks** (`FilterBar` `q` → `board.filtered`). It has no server round-trip and no
notion of other entity types; the board state holds only tasks. Mixing docs into
that board filter would mean loading every doc into the board state and
rendering non-task rows in a task board — not a clean fit. Per the ticket's
escape hatch, **doc search is implemented on `/docs`** (server-side LIKE over
title + body) and the board's global search stays task-only. A "Docs" nav link
makes the doc search discoverable. (A future unified search page could join
both; out of scope for v1.4.)

## Permissions

- Create / edit / link / unlink: human **and** AI (same as task create/edit).
- Delete a document: human only; AI → 403 (same rule and 403 message style as
  task delete). The service enforces it; the UI hides the button for AI.

## Testing

- **Vitest (service + permissions):** create/list/get/update/delete; AI may
  create+edit but AI delete → 403; project filter; search over title AND body
  (LIKE); link/unlink idempotency; delete cleans up link rows; linked docs
  appear on task detail and linked tasks on doc detail.
- **Playwright e2e:** login → create doc → renders as HTML → link a task →
  linked task shows on the doc and the doc shows on the task.
- `npm run build`, `npm run test:unit`, `npm run test:e2e` all green.

## Ops / deploy (production instance — instructions only, NOT run here)

- Additive migration only; applied automatically on boot by `createDb`
  (`migrate(...)` runs the `drizzle/` folder). No manual SQL needed — a normal
  `scripts/deploy-vps.sh` pull + restart applies `0004_documents`.
- No new env vars, no new on-disk assets (docs are pure DB rows). Nightly SQLite
  backup already covers the new tables.

## Known limitations (accepted for v1.4)

- No document versioning / history (unlike task status history).
- No SSE live-update for docs or for the task-detail linked-docs list (the board
  never shows docs; doc pages load fresh). Acceptable at 3-user scale.
- Search is substring LIKE, not ranked full-text.
