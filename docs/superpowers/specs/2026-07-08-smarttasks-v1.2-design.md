# SmartTasks v1.2 — Status History, Delete, Location Display, Panel Fixes

**Date:** 2026-07-08
**Status:** Approved design (user authorized spec → plan → execution → deploy in one go)
**Builds on:** v1.1 (shipped, live at tasks.remoterepublic.com)

## Purpose

Feedback from first production use:

1. Show a task's location (via its project) on cards and in the detail panel.
2. The detail panel overflows horizontally on every task. Root cause: since the
   project import, `projectLabel` options like `Imbiss Baugenehmigung Studio
   Wandlitz (Studio Wandlitz)` set the `<select>` intrinsic width; the panel's
   `1fr 1fr` grid cannot shrink below select min-content → grid blowout.
3. A visible, trustworthy record of status changes: when a task is set to Done
   (or any status), record when and by whom, shown under "Created by".
   (`completedAt` already exists server-side; the history makes it visible and
   complete.)
4. Delete a task from the detail view — humans only.
5. Show the task ID for unambiguous human↔AI communication.

## Data model

### status_events (new)
| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| task_id | FK tasks NOT NULL | |
| user_id | FK users NOT NULL | who made the change |
| from_status | status enum, nullable | null = task creation |
| to_status | status enum NOT NULL | |
| created_at | datetime NOT NULL | ISO string |

Written by `createTask` (from=null, to=initial status) and by `updateTask` only
when the status actually changes. One additive Drizzle migration. Existing
tasks simply have no history rows (their creation predates the feature).

## Services & API

- `getTask` additionally returns `statusEvents: StatusEventDTO[]` (ascending by
  createdAt). `StatusEventDTO = { id, taskId, userId, fromStatus, toStatus, createdAt }`.
- New `deleteTask(db, user, id)`: 404 `task not found`; `user.type === 'ai'` →
  403 `AI users cannot delete tasks`; deletes comments, status_events, then the
  task in one transaction. Endpoint `DELETE /api/tasks/:id` → `{ ok: true }`,
  emits new SSE event `{ type: 'task.deleted', task }` (task = the deleted row)
  so open boards remove the card live; the board store handles the new type.
- `/api/docs`: document DELETE (human-only), the `statusEvents` field, and the
  convention of referencing tasks as `#<id>` in human↔AI communication.

## UI

- **Task ID:** panel header shows `#<id>` (muted, before the title input).
  Not shown on cards.
- **Location on cards:** grey badge with the location name after the project
  badge, only when the task's project has a location.
- **Location in panel:** read-only "Location" field next to Project (derived
  from the selected project; updates when the project changes). Em dash when none.
- **Status history in panel:** under the "Created by …" line, one line per
  event: `Inbox → In Progress · Micha · 2026-07-08 14:12` (creation event shows
  `→ Inbox`). Replaces the separate "Completed …" display.
- **Delete:** red "Delete task" text button at the panel bottom. First click
  turns it into "Really delete?" (inline two-step, no browser confirm); second
  click calls DELETE, removes the task from the board store, closes the panel,
  toasts errors. The button is visible to every logged-in user; the server
  enforces the human-only rule.
- **Panel width fix:** `.fields { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) }`,
  `select { max-width: 100%; }` inside the fields grid, and
  `.rendered, .comments article { overflow-wrap: anywhere }` for long
  URLs/tokens in markdown. Panel stays `min(480px, 95vw)` on desktop and the
  existing 100vw sheet on mobile — no horizontal scrolling in either.

## Testing

- Unit: status events on create + on status change + none on same-status patch
  + none on non-status patch; getTask returns them ordered; deleteTask cascade
  (comments + events gone), AI → 403, missing → 404.
- E2E (desktop spec extended): after moving the task, the panel shows a history
  line containing `→ In Progress`; delete flow — click Delete task → Really
  delete? → task gone from the board.

## Out of scope

Editing/undo of history, delete for AI users, soft-delete/trash, task ID on
cards, history pagination.
