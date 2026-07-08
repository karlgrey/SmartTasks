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
6. Reference tasks as \`#<id>\` when communicating with humans — the id is shown in the UI.

## Endpoints
| Method & path | Purpose |
|---|---|
| GET /api/tasks | List. Query: assignee (user id or name), project (id), location (id, matches the task's project location), status, open=true (status ≠ Done), q (text search), limit, offset |
| POST /api/tasks | Create: {title, description?, status?, priority?, size?, hours?, dueDate?, assigneeId?, projectId?} |
| GET /api/tasks/:id | Detail incl. comments and statusEvents (status history: who set which status when) |
| PATCH /api/tasks/:id | Partial update (same fields as create) |
| DELETE /api/tasks/:id | Delete a task incl. comments and history — human users only (403 for AI) |
| POST /api/tasks/:id/comments | Add comment: {body} |
| GET /api/projects · POST /api/projects · PATCH /api/projects/:id | Projects: {name, color?, archived?, locationId?, wikiRef?} |
| GET /api/locations · POST /api/locations · PATCH /api/locations/:id | Locations: create {name}, update {name?, archived?} |
| GET /api/users | All users (id, name, type human/ai) |
| GET /api/events | SSE stream of task changes |

## Values
- status: Inbox | To Do | Icebox | In Progress | Supplier | Review | Done
- priority: Super-High | High | Medium | Low — size: S | M | L
- dueDate: YYYY-MM-DD. Errors: JSON {"error": "..."} with proper HTTP status.

## Projects, locations & TheBrain2
Projects and locations are maintained via this API only — there is no management UI.
A project may carry a \`wikiRef\`: the page name of its knowledge page in the TheBrain2
vault (\`wiki/projekte/<wikiRef>.md\`). When you work a task, read that page for project
context if a wikiRef is set. Locations are physical places; each project has at most one.
`;
