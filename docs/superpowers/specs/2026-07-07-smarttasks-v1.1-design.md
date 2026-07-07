# SmartTasks v1.1 — Locations & Mobile

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-07-07-smarttasks-design.md` (v1, shipped)

## Purpose

Two gaps from first real use of v1:

1. **Locations for projects.** Projects belong to physical locations (Schiffmühle,
   Studio Wandlitz, Wohnwerk Wandlitz, …). The knowledge about projects and
   locations lives in the TheBrain2 Obsidian vault (`wiki/projekte/*.md`,
   `wiki/orte/*.md`) — that stays the source of truth. SmartTasks only needs the
   structural link: a locations list, a location per project, and a way for AI
   sessions to jump from a task to the TheBrain2 wiki page.
2. **Responsive design.** Mobile use case is capture + status checking; the
   7-column board is unusable on a phone.

## Decisions (from brainstorming)

- **No management UI, no sync.** Projects and locations are maintained via the
  REST API only (by Micha or Claude sessions). No TheBrain2 sync automation in
  this version; the wiki remains canonical, SmartTasks mirrors what the API is
  told.
- Locations are a first-class table; **one location per project** (nullable).
- Projects get a **wikiRef** (TheBrain2 page name) so AI sessions can find
  project context at `TheBrain2/wiki/projekte/<wikiRef>.md`.
- Mobile shows **one column with a status switcher** (chips with counts);
  status changes happen via the detail panel, not drag & drop. Desktop is
  unchanged.

## Data model

### locations (new)
| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| name | text unique | required, trimmed, non-empty |
| archived | boolean default false | hidden from selects/filters when true |

No color, no description — the knowledge layer lives in TheBrain2.

### projects (extended)
| New column | Type | Notes |
|---|---|---|
| location_id | FK locations nullable | validated on write: must reference an existing location, else 400 |
| wiki_ref | text nullable | TheBrain2 wiki page name, e.g. `Teichbau Schiffmühle` |

Migration: one new Drizzle migration (table + two columns), applied at boot as
usual. No backfill; existing projects keep `location_id = null`.

## API

- `GET /api/locations` — all locations incl. archived (clients filter)
- `POST /api/locations` — `{ name }` → 201; 400 `name is required` on empty
- `PATCH /api/locations/:id` — `{ name?, archived? }`; 404 `location not found`;
  empty patch is a no-op returning the unchanged location (same convention as
  projects)
- `POST /api/projects` / `PATCH /api/projects/:id` additionally accept
  `locationId` (number | null) and `wikiRef` (string | null), type-validated;
  unknown `locationId` → 400 `invalid locationId: location not found`
- `GET /api/tasks?location=<id>` — new filter: tasks whose project has that
  location (combines with existing filters; tasks without a project never match)
- All errors follow the existing convention: JSON `{ "error": ... }` via
  ServiceError with correct status. Auth as before (session cookie or Bearer).
- `/api/docs` gains a Locations section and the wikiRef convention, including
  the note for AI sessions: project knowledge lives in the TheBrain2 vault at
  `wiki/projekte/<wikiRef>.md`.

## UI

### Desktop — location filter
- FilterBar gets a **location select** ("All locations") next to the project
  select. Client-side filter: tasks whose project's `locationId` matches. Lives
  in the URL (`?location=3`), combines with assignee/project/search.
- Project dropdowns (FilterBar + task panel) render the location after the
  name: `Teichbau (Schiffmühle)`.
- Desktop board is otherwise unchanged (7 columns, drag & drop).

### Mobile (< 768px breakpoint)
- Board renders **one full-width column**. Above it, a horizontally scrollable
  **status chip row with counts** (`Inbox 3 · To Do 12 · …`); tapping switches
  the column. Initial status: Inbox. Selection is local UI state (not URL).
- Quick-add sits at the top of the active column.
- The task detail panel opens as a **full-screen sheet** (100vw) with a
  single-column field grid; touch targets ≥ 44px. Status changes happen here.
- FilterBar stays but scrolls horizontally instead of wrapping.
- Implementation: CSS breakpoint plus a small mobile branch in `Board.svelte`;
  store, filters, SSE logic stay one codebase. No separate route.

## Testing

- **Unit (Vitest):** locations service (create/rename/archive, 400/404, empty
  patch no-op); project validation (unknown locationId → 400, wikiRef type
  check); `listTasks` location filter incl. combination with `open=true` and
  the no-project case.
- **E2E (Playwright):** second smoke test at 390px viewport — status chips
  visible, single column, quick-add creates in the active column, panel opens
  full-screen, status change via panel select moves the task.

## Out of scope (v1.1)

TheBrain2 sync automation, location colors/metadata, multiple locations per
project, management UI for projects/locations, mobile drag & drop, swipe
gestures, URL-persisted mobile column selection.
