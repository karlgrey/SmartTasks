# SmartTasks v1.3 — Photo Attachments

**Date:** 2026-07-09
**Status:** Shipped 2026-07-09 (deployed to tasks.remoterepublic.com; feature commits
`d4a1b02..b67dc32`, UI polish `8022e44` + `3435a89`)
**Builds on:** v1.2 (shipped, live at tasks.remoterepublic.com)

## Purpose

Attach photos to tasks (e.g. site photos from the phone). Hard constraint from
Micha: **board speed must not suffer** — it is "gerade richtig gut". Photos are
therefore a detail-panel-only feature; the board view loads zero image bytes
and its DTOs are unchanged.

Decisions made during brainstorming:

- Photos attach **to the task** (gallery in the detail panel), not to comments.
- **Humans only**: upload via the web UI with session auth; AI users get 403.
  API upload for agents can be added later if ever needed.
- **Downscaled only**: the browser resizes to max 1600px JPEG before upload
  (canvas). No originals kept, no server-side image processing, no new native
  dependency (no sharp).
- **Board untouched**: no attachment count on TaskDTO, no 📷 icon on cards.

## Storage approach

Files on disk + auth-guarded serving endpoint (chosen over SQLite BLOBs, which
bloat the DB/backup and block the event loop on large reads, and over object
storage, which is overkill for a 3-person tool).

- Files live in `data/uploads/` (i.e. sibling of the SQLite file; on prod
  `/opt/smarttasks/data/uploads/`), named `<attachmentId>.jpg`.
- Server enforces a 5 MB per-file limit as a safety net (client normally sends
  ~200–400 KB).

## Data model

### attachments (new)
| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| task_id | FK tasks NOT NULL | |
| filename | text NOT NULL | original name, display only |
| mime | text NOT NULL | image/jpeg·png·webp; drives Content-Type when serving |
| size | integer NOT NULL | bytes as stored |
| created_by | FK users NOT NULL | |
| created_at | datetime NOT NULL | ISO string |

One additive Drizzle migration. Task detail response gains
`attachments: AttachmentDTO[]` (id, filename, size, createdBy, createdAt).
TaskDTO (board) is unchanged.

## API

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/tasks/:id/attachments` | POST | session, human only (AI → 403) | multipart form (`file`), validates image/jpeg+png+webp, ≤5 MB → stores file, inserts row, 201 AttachmentDTO |
| `/api/attachments/:id` | GET | session or bearer | streams the file with correct Content-Type + long-lived Cache-Control (content is immutable) |
| `/api/attachments/:id` | DELETE | session, human only | removes row + file |

AI users may read (GET) — attachments are listed in the task detail JSON they
already fetch — but cannot upload or delete. `/api/docs` gets a short note.

Deleting a task deletes its attachment rows (FK cascade) and unlinks the files
(best-effort in `deleteTask`).

## Client (detail panel)

- New "Photos" row between description and comments: previews as a
  **two-column 4:3 grid** (half panel width each, `object-fit: cover`,
  `loading="lazy"`), plus a compact 72px add tile — so an empty section stays
  small (the common case). *(Post-ship revision by Micha; originally shipped as
  a 72px strip.)*
- `<input type="file" accept="image/*" multiple>` — on mobile this offers the
  camera directly.
- Before upload the client downscales via canvas: longest edge ≤1600px,
  JPEG quality ~0.8. Non-image files are rejected client-side.
- Click on a thumbnail opens the full image (`/api/attachments/:id`) in a new
  tab. No lightbox in v1.3 (YAGNI).
- Delete per photo via small × using the existing two-step confirm pattern.
- Upload errors surface via the existing toast mechanism.

## Performance guarantees

- Board: zero change — no image bytes, no DTO change, no extra queries.
- Detail panel: thumbnails load lazily after panel data; images are immutable
  → aggressive browser caching; files are small by construction (client-side
  downscale).
- Serving streams from disk via the Node adapter; no image processing at
  request time.

## Ops

- Nightly backup cron gains the uploads dir (rsync/tar alongside the existing
  sqlite backup, same 14-day rotation).
- `data/uploads/` is created on demand (`mkdirSync recursive`, matching db
  bootstrap); gitignored via existing `data/` handling.

## Testing

- Service-level unit tests: create/list/delete attachment rows, task-delete
  cleanup, AI-user 403.
- E2E happy path: upload (fixture image), thumbnail renders, full view
  responds 200, delete removes it.
- Out of scope: EXIF handling (canvas re-encode strips EXIF as a side effect,
  which also removes GPS data — acceptable and arguably a feature).

## Known accepted limitations

- No originals: what you upload is the 1600px version, full stop.
- Canvas re-encode loses animated GIFs/HEIC exotica; accepted for v1.3.
- No storage quota; monitor disk via existing server maintenance.
