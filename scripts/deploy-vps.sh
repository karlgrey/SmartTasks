#!/bin/sh
# Deploy the current main branch on the VPS. Run ON the server:
#   ssh deploy@labs.remoterepublic.com '/opt/smarttasks/scripts/deploy-vps.sh'
set -e
export PATH=/home/deploy/.nvm/versions/node/v22.20.0/bin:$PATH
cd /opt/smarttasks
git pull --ff-only
npm install --no-audit --no-fund
# server npm (10.x) rewrites the npm-11 lockfile; keep the tree clean for the next pull
git checkout -- package-lock.json
npm run build
sudo systemctl restart smarttasks.service
sleep 2
systemctl is-active smarttasks.service
curl -sf -o /dev/null localhost:3020/login && echo "deploy ok: $(git log --oneline -1)"
