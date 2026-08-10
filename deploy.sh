#!/usr/bin/env bash
# =====================================================================
# Einheitliches Deployment für SmartTasks (tasks.remoterepublic.com).
#
# Gleiches Modell wie die Site-Repos (studio-wandlitz.de/deploy.sh):
# lokal pushen → Server pullt → baut → startet neu → Health-Check.
# Zusätzlich (App mit SQLite-Daten): DB-Backup vor dem Restart.
# Drizzle-Migrationen laufen beim App-Start automatisch (db/index.ts).
#
#   ./deploy.sh
#
# Bricht `git pull --ff-only` ab, ist der Server-Checkout abgedriftet —
# Reparatur siehe Wiki [[Server-App anbinden]] („Drift geradeziehen").
# =====================================================================
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-deploy@labs.remoterepublic.com}"
REMOTE_PATH="${REMOTE_PATH:-/opt/smarttasks}"
SERVICE="${SERVICE:-smarttasks}"
HEALTH_URL="${HEALTH_URL:-https://tasks.remoterepublic.com/}"
# Ubuntu-Node 18 hat eine abweichende ABI → better-sqlite3 lädt nicht.
NODE_BIN="${NODE_BIN:-/home/deploy/.nvm/versions/node/v22.20.0/bin}"

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Abbruch: uncommittete Änderungen im Arbeitsbaum." >&2
  git status --short >&2
  exit 1
fi

echo "→ Lokal pushen"
git push

echo "→ Server: DB-Backup + pull + build + restart"
ssh "$REMOTE_HOST" bash -euo pipefail << REMOTE
export PATH="$NODE_BIN:\$PATH"
cd '$REMOTE_PATH'
# DB-Backup (ein Stand pro Tag reicht; ältere räumt der Monats-Lint ab)
if [ -f data/smarttasks.db ]; then
  cp -n data/smarttasks.db "data/smarttasks.db.bak-\$(date +%F)" || true
fi
git pull --ff-only origin main
# npm install statt npm ci: das macOS-Lockfile enthält die Linux-seitigen
# Optional-Deps (@emnapi/*) nicht — npm ci bricht dann ab (npm/cli#4828).
npm install --no-audit --no-fund --silent
npm run build
sudo systemctl restart '$SERVICE'
REMOTE

echo "→ Health-Check"
sleep 3
code=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 15 "$HEALTH_URL" || echo 000)
if [ "$code" != "200" ]; then
  echo "✗ Health-Check fehlgeschlagen: $HEALTH_URL → $code" >&2
  echo "  Logs: ssh $REMOTE_HOST 'journalctl -u $SERVICE -n 40 --no-pager'" >&2
  exit 1
fi
echo "✓ Deploy ok — $HEALTH_URL → $code"
