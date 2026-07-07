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

## Deploy (Fly.io)
	fly launch --no-deploy          # once; creates the app, keep the generated name in fly.toml
	fly volumes create smarttasks_data --size 1
	fly secrets set LITESTREAM_REPLICA_URL=s3://<bucket>/smarttasks AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…
	fly deploy
	fly ssh console -C "npm run seed"   # once, on the first deploy

Without `LITESTREAM_REPLICA_URL` the app runs fine but unreplicated (volume snapshots only).
