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

## Endpoints
| Method & path | Purpose |
|---|---|
| GET /api/tasks | List. Query: assignee (user id or name), project (id), status, open=true (status ≠ Done), q (text search), limit, offset |
| POST /api/tasks | Create: {title, description?, status?, priority?, size?, hours?, dueDate?, assigneeId?, projectId?} |
| GET /api/tasks/:id | Detail incl. comments |
| PATCH /api/tasks/:id | Partial update (same fields as create) |
| POST /api/tasks/:id/comments | Add comment: {body} |
| GET /api/projects · POST /api/projects · PATCH /api/projects/:id | Projects: {name, color?, archived?} |
| GET /api/users | All users (id, name, type human/ai) |
| GET /api/events | SSE stream of task changes |

## Values
- status: Inbox | To Do | Icebox | In Progress | Supplier | Review | Done
- priority: Super-High | High | Medium | Low — size: S | M | L
- dueDate: YYYY-MM-DD. Errors: JSON {"error": "..."} with proper HTTP status.
`;
