# SmartTasks — Design

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan

## Purpose

SmartTasks replaces the Notion Tasks database (3,702 tasks, 5 board views) with a
lean, fast, self-owned web app for task management shared seamlessly between
humans and AI agents. No migration — fresh start; Notion stays available as a
read-only archive.

The key improvement over Notion: AI agents are first-class users and assignees,
replacing the current `Supplier = "Claude"` workaround documented in the Notion
page "Zusammenarbeit mit Claude – Workflow".

## Decisions (from brainstorming)

- **AI access:** REST API only (no MCP server). Agents authenticate with API keys.
- **AI workflow:** Pull model — agents fetch their open tasks; no webhooks/push in v1.
- **Users:** Fixed user list, created via seed script. Email + password login,
  session cookie. No registration flow, no OAuth.
- **Views:** Kanban board only, with assignee/project/text filters. No list or
  calendar view in v1.
- **Fields kept:** title, description, status, assignee, project, priority,
  due date, size, hours, comments.
- **Fields dropped:** sub-tasks, blocked-by/blocking, tags, est. costs,
  stakeholder, timeline, LC_old.
- **Statuses:** taken over 1:1 from Notion: Inbox, To Do, Icebox, In Progress,
  Supplier, Review, Done.
- **Migration:** none. Empty system at launch.
- **Hosting:** cloud (Fly.io), single small instance.
- **Stack:** SvelteKit + SQLite, single Node process.

## Architecture

One SvelteKit app serves both the web UI and the REST API from a single Node
process. SQLite (via Drizzle ORM, WAL mode) is the only datastore — a file on a
persistent volume. No separate backend, no DB server, no queue.

```
Browser (SvelteKit UI, session cookie) ─┐
                                        ├─► SvelteKit server ─► SQLite (WAL)
AI agents (curl/scripts, Bearer key) ───┘        │
                                                 └─► SSE stream → live board updates
```

## Data model

### users
| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| name | text | display name |
| email | text unique | login for humans |
| type | `human` \| `ai` | |
| password_hash | text nullable | humans only (argon2/bcrypt) |
| api_key_hash | text nullable | AI users only |
| color | text | board avatar color |

### projects
| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| name | text | |
| color | text | |
| archived | boolean | hidden from filters when true |

### tasks
| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| title | text | required |
| description | text | Markdown, optional |
| status | enum | Inbox, To Do, Icebox, In Progress, Supplier, Review, Done |
| priority | enum nullable | Super-High, High, Medium, Low |
| size | enum nullable | S, M, L |
| hours | real nullable | logged hours |
| due_date | date nullable | |
| assignee_id | FK users nullable | |
| project_id | FK projects nullable | |
| created_by | FK users | |
| created_at / updated_at | datetime | |
| completed_at | datetime nullable | set automatically when status → Done |

### comments
| Column | Type | Notes |
|---|---|---|
| id | integer PK | |
| task_id | FK tasks | |
| author_id | FK users | |
| body | text | Markdown |
| created_at | datetime | |

AI agents write their results as comments (not into the description), so the
history of who delivered what stays traceable.

### Business rules
1. **AI users cannot set status to Done** — Review at most. Enforced server-side
   (403). Human review → Done stays a human act.
2. Board sort order within a column: priority → due date → created_at. No manual
   reordering; drag & drop only changes the column (= status).

## REST API

One API for both clients. Web UI authenticates via httpOnly session cookie;
agents via `Authorization: Bearer <api-key>`. All responses JSON with proper
HTTP status codes and an error message body.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout` | Human sessions |
| `GET /api/tasks?assignee=&project=&status=&open=true&q=` | Filterable list. `open=true` = status ≠ Done; `assignee` accepts user id or name (case-insensitive) |
| `POST /api/tasks` | Create task |
| `GET /api/tasks/:id` | Detail incl. comments |
| `PATCH /api/tasks/:id` | Partial update |
| `POST /api/tasks/:id/comments` | Append comment/result |
| `GET /api/projects`, `POST`, `PATCH /api/projects/:id` | Projects |
| `GET /api/users` | User list for filters/assignment |
| `GET /api/events` | SSE stream of task changes |
| `GET /api/docs` | Markdown API description for agents (replaces the Notion workflow page) |

The current Claude workflow becomes:
`GET /api/tasks?assignee=claude&open=true` → work task → `POST comment` →
`PATCH status: Review`.

Users are created by a seed script; API keys are generated per AI user via a CLI
command. No rate limiting in v1 (trusted, small user set).

## UI

Single board view:

- **7 columns** (Inbox → Done). Cards: title, assignee dot/initials, priority
  badge, project chip, due date (red when overdue).
- **Filter bar:** assignee chips (one click = "Micha board" / "Claude board",
  replacing the Notion views), project select, full-text search. Filters live in
  the URL (bookmarkable).
- **Quick-add** per column: type title, Enter.
- **Task detail as slide-over panel**, no page navigation. All fields inline
  editable, Markdown description, comment thread. URL reflects open task
  (`/task/123`) so links work — including from AI responses.
- **Drag & drop** between columns with optimistic updates; on server error the
  card snaps back with a toast.
- **Live updates via SSE:** background changes by agents appear immediately
  (card highlight flash).
- **Done column** shows the most recent ~50 tasks ("load more" for older) so the
  board stays fast over years.
- Responsive: horizontal column scrolling on mobile. UI copy in English
  (matching status names).

## Error handling

- API: proper HTTP codes, JSON error body (e.g. `403 — AI users cannot set
  status to Done`).
- UI: optimistic updates roll back visibly with a toast on failure.
- SSE: automatic reconnect, followed by a fresh board fetch to resync.
- SQLite in WAL mode; write contention is a non-issue at this scale.

## Backups

Litestream continuously replicates the SQLite file to object storage
(S3/Backblaze). Restore = copy one file back.

## Testing

- **Unit (Vitest):** API rules — auth (cookie + bearer), filters, the
  AI-cannot-Done rule, status transitions, completed_at stamping.
- **E2E (Playwright):** one smoke flow — create task via quick-add, drag to
  another column, open detail, add comment.
- Implementation is test-first (TDD).

## Deployment

Docker container on Fly.io, persistent volume for SQLite, automatic HTTPS,
secrets via env vars, seed script for users. Expected cost ~0–5 €/month.

## Out of scope (v1)

Migration from Notion, MCP server, webhooks/push to agents, list/calendar views,
sub-tasks, dependencies, tags, cost tracking, manual card ordering, user
self-registration, rate limiting.
