export const API_DOCS = `# SmartTasks API

Task manager shared by humans and AI agents. Base URL: this host.

## Authentication
- Humans: \`POST /api/auth/login\` with \`{"email": "...", "password": "..."}\` → sets an httpOnly \`session\` cookie. \`POST /api/auth/logout\` ends it.
- AI agents: send \`Authorization: Bearer <api-key>\` on every request. Keys are issued by an admin (\`npm run seed\` / \`scripts/create-api-key.ts\`).

## Workflow for AI agents
1. Fetch your open tasks: \`GET /api/tasks?assignee=<your-user-name>&open=true\` (sorted by priority, then due date).
2. Work a task. Write your result as a comment: \`POST /api/tasks/:id/comments\` with \`{"body": "..."}\` (Markdown).
3. Set the task to Review: \`PATCH /api/tasks/:id\` with \`{"status": "Review"}\`.
4. Never set status \`Done\` or \`Dropped\` on tasks created by humans — the server rejects it with 403; a human reviews and closes. Exception: tasks **you created yourself** (e.g. retroactive work documentation) may be set to Done or Dropped directly.
5. New findings worth tracking? Create a task assigned to yourself: \`POST /api/tasks\`.
6. Reference tasks as \`#<id>\` when communicating with humans — the id is shown in the UI.

## Endpoints
| Method & path | Purpose |
|---|---|
| GET /api/tasks | List. Query: assignee (user id or name), project (id), location (id, matches the task's project location), status (\`Done\`/\`Dropped\` are sorted newest-closed first), open=true (status neither Done nor Dropped), today=true (open, and due today or earlier — Europe/Berlin-local), q (text search; a bare number also matches that task id exactly, \`#18\` matches ids by prefix), limit, offset |
| GET /api/tasks/counts | Total task count per status ({"Inbox": n, "To Do": n, ..., "Dropped": n}), same visibility rule as GET /api/tasks (no other filters apply) |
| POST /api/tasks | Create: {title, description?, status?, priority?, size?, hours?, dueDate?, assigneeId?, projectId?} (\`routineRunId\` is PATCH-only, see Routines) |
| GET /api/tasks/:id | Detail incl. comments, statusEvents (status history: who set which status when), attachments (photos: id, filename, mime, size, createdBy, createdAt) and documents (linked docs: id, title) |
| PATCH /api/tasks/:id | Partial update (same fields as create, plus \`routineRunId\`: link the task to a routine run / \`null\` to unlink) |
| DELETE /api/tasks/:id | Delete a task incl. comments and history — human users only (403 for AI); returns \`{"ok": true}\` |
| POST /api/tasks/:id/comments | Add comment: {body} |
| GET /api/attachments/:id | The attachment's bytes (images inline, other types incl. PDF/docx/xlsx as a download). Upload/delete of attachments is human/web-UI only (403 for AI) |
| GET /api/projects · POST /api/projects · PATCH /api/projects/:id | Projects: {name, color?, archived?, locationId?, wikiRef?, ownerId?} |
| GET /api/locations · POST /api/locations · PATCH /api/locations/:id | Locations: create {name}, update {name?, archived?} |
| GET /api/users | All users (id, name, type human/ai) |
| GET /api/events | SSE stream of task changes |
| GET /api/documents | List docs. Query: project (id), q (LIKE over title+body), limit, offset; pinned docs first, then newest-updated first |
| POST /api/documents | Create a doc: {title, body?, projectId?} (Markdown body) |
| GET /api/documents/:id | Doc detail incl. \`tasks\` (linked tasks: id, title, status) |
| PATCH /api/documents/:id | Partial update: {title?, body?, projectId?, pinned?} — pinning is open to humans and AI alike |
| DELETE /api/documents/:id | Delete a doc incl. its task links — human users only (403 for AI) |
| POST /api/documents/:id/tasks | Link a task to the doc: {taskId} (idempotent) |
| DELETE /api/documents/:id/tasks/:taskId | Unlink a task from the doc |
| POST /api/tasks/:id/documents | Link a doc to the task: {documentId} (reciprocal, same effect) |
| DELETE /api/tasks/:id/documents/:documentId | Unlink a doc from the task |
| GET /api/routines · POST /api/routines | List routines (query: project, assignee, active=true\|false; sorted by nextDue) · create (201) |
| GET /api/routines/dashboard | Dashboard: counts + one entry per routine with state (see Routines) |
| GET /api/routines/:id · PATCH · DELETE | Detail incl. last 12 runs · update · delete (human only, 409 if runs exist — deactivate instead) |
| GET /api/routines/:id/runs · POST /api/routines/:id/runs | Run history (due desc, query: limit) · report a run (201) |
| POST /api/routines/:id/runs/attach | Attach an existing task to a run: {taskId, due?} → {run, task} |
| POST /api/routines/:id/materialize | "Create run now": {due?} → 201 {run, task} |
| POST /api/routines/tick | Run the scheduler now (idempotent) → {today, runsCreated, tasksCreated, missed} |

## Values
- status: Inbox | To Do | In Progress | Supplier | Review | Done | Icebox | Dropped
- \`Done\` = erledigt; \`Dropped\` = bewusst verworfen/obsolet, nie gemacht (keine eigene Board-Spalte, sichtbar im Done-Umschalter „Verworfen"). Both set \`completedAt\` (time of closing); leaving them clears it. Convention when dropping: add a comment \`Verworfen: <Grund>\`.
- priority: Super-High | High | Medium | Low — size: XS | S | M | L
- dueDate: YYYY-MM-DD. Errors: JSON {"error": "..."} with proper HTTP status.

## Projects, locations & TheBrain2
Projects and locations are maintained via this API only — there is no management UI.
A project may carry a \`wikiRef\`: the page name of its knowledge page in the TheBrain2
vault (\`wiki/projekte/<wikiRef>.md\`). When you work a task, read that page for project
context if a wikiRef is set. Locations are physical places; each project has at most one.
Convention: every project gets a location — projects without a physical place (digital,
overhead, cross-location work) use the location named \`None\`.

## Routines
A routine is a recurring piece of work (e.g. "Gehälter", monthly). It has **runs** (\`routine_runs\`, one per due date);
a run becomes a task only shortly before it is due. Routines hang on a project (visibility = project visibility,
foreign private → 404). Keep the routine title generic ("Gehälter"); the task title gets the period appended
(\`Gehälter · Okt 2026\`, \`… · KW 42\`, \`… · Q4 2026\`, \`… · 2026\`, day: \`… · 05.10.\`).
- Routine fields: \`title\`, \`description\`, \`projectId\` (required), \`locationId?\`, \`assigneeId?\`, \`rhythm\`, \`leadDays\`
  (default: 3; week 1; day 0), \`materialize\` (default true), \`active\` (default true), \`nextDue\` (YYYY-MM-DD, must be >= today;
  default = first occurrence on/after today).
- \`rhythm\`: \`{"unit": "day|week|month|quarter|year", "interval": 1, "weekday?": 1-7 (Mon=1, only week), "dayOfMonth?": 1-31 (only month/quarter)}\`.
  Day-of-month values beyond the month's length are clamped to the month end.
- Run: \`{id, routineId, due, status: open|done|skipped|missed, taskId, doneAt, note, createdAt}\`, unique per (routine, due).
- **Scheduler** (\`POST /api/routines/tick\`, also run automatically once per Berlin day by the first authenticated request):
  for every active routine, as long as \`nextDue − leadDays <= today\`: ensure an open run for \`nextDue\`; if \`materialize\`
  and the run has no task, create one (status To Do, dueDate = due, project/assignee from the routine, description ends with
  \`Routine #<id>, Lauf fällig <due>\`); then advance \`nextDue\`. Open runs older than 7 days become \`missed\` (the task is left alone).
- **Automation routines** (\`materialize: false\`) never get tasks: a bot reports each run via \`POST /api/routines/:id/runs\`
  with \`{due?, status?: done|skipped|open (default done), note?}\` (due defaults to the oldest open/missed run, else \`nextDue\`;
  upsert per due; \`nextDue\` moves past the reported due).
- Tasks of a run keep their own status; closing one syncs the run: Done → done, Dropped → skipped (the routine keeps running),
  any other status → open. Deleting the task keeps the run (taskId becomes null). Tasks carry \`routineRunId\`;
  \`GET /api/tasks/:id\` adds \`routine: {id, title}\` and \`routineRun: {id, due, status}\`.
- Dashboard (\`GET /api/routines/dashboard?project=&assignee=\`): \`{today, counts: {overdue, today, thisWeek}, routines: [{id, title,
  rhythm, rhythmText, leadDays, materialize, active, project, assignee, lastRun, openRun, nextDue, state, task}]}\`;
  \`state\` = paused | broken (a missed run among the last 12) | overdue | due (open run due within leadDays) | ok.
- AI users may do everything except DELETE (403).

## Private projects
- A project with \`ownerId\` set is private: visible only to its (human) owner and to AI users.
  Tasks, comments, attachments, linked documents and SSE events inherit this via the project.
- Foreign private resources answer **404** (as if they did not exist), never 403.
- Humans may only set \`ownerId\` to themselves; AI users may set any human owner.
  Only the owner can set \`ownerId\` back to null (make it public). Owners cannot be transferred.
- Tasks in a private project can only be assigned to the owner or an AI user.
- Note for AI users: you can read every private project. Treat other users' private
  tasks as confidential — never quote or reference them in team-visible output.
`;
