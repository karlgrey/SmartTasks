# SmartTasks

Lean kanban task manager for humans and AI agents. SvelteKit + SQLite, one process.

## Development
	npm install
	DATABASE_PATH=data/dev.db npm run seed   # once; prints passwords + Claude's API key
	DATABASE_PATH=data/dev.db npm run dev

## Tests
	npm run test:unit
	npm run test:e2e

## API
Agents authenticate with `Authorization: Bearer <api-key>` — full guide at `/api/docs`.
Issue/rotate a key: `npx tsx scripts/create-api-key.ts <user-name>`.

## Deploy (Strato VPS)

Production runs at https://tasks.remoterepublic.com on the labs VPS:
`/opt/smarttasks`, systemd unit `smarttasks.service` (nvm Node 22, port 3020,
`DATABASE_PATH=/opt/smarttasks/data/smarttasks.db`), Caddy vhost in
`/etc/caddy/Caddyfile`, nightly SQLite backup via cron to `/opt/backups/smarttasks/`
(14-day rotation). The server pulls from the public GitHub repo via https —
no deploy key.

Ship an update:

	ssh deploy@labs.remoterepublic.com '/opt/smarttasks/scripts/deploy-vps.sh'

### Photo attachments (v1.3)

- Files live in `<dirname(DATABASE_PATH)>/uploads/` (prod: `/opt/smarttasks/data/uploads/`).
- adapter-node caps request bodies at 512K by default — production needs
  `BODY_SIZE_LIMIT=6M` in the systemd unit (matches the server-side 5 MB limit).
- `ORIGIN=https://tasks.remoterepublic.com` must be set in the systemd unit:
  SvelteKit's CSRF check rejects the multipart upload POST without it
  (JSON endpoints are exempt, which is why everything else works regardless).
- The nightly backup must include the uploads dir alongside the sqlite file.

Add a user / rotate an agent key (on the server, with the production DATABASE_PATH):

	npx tsx scripts/create-user.ts <name> <email> [color]
	npx tsx scripts/create-api-key.ts <user-name>

The repo also ships Docker/Fly.io/Litestream files (`Dockerfile`, `fly.toml`,
`litestream.yml`) as an alternative container path; they are not used by the
VPS setup.
