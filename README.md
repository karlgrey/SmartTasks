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

Add a user / rotate an agent key (on the server, with the production DATABASE_PATH):

	npx tsx scripts/create-user.ts <name> <email> [color]
	npx tsx scripts/create-api-key.ts <user-name>

The repo also ships Docker/Fly.io/Litestream files (`Dockerfile`, `fly.toml`,
`litestream.yml`) as an alternative container path; they are not used by the
VPS setup.
