#!/bin/sh
# Deploy the current main branch on the VPS. Run ON the server:
#   ssh deploy@labs.remoterepublic.com '/opt/smarttasks/scripts/deploy-vps.sh'
set -e
export PATH=/home/deploy/.nvm/versions/node/v22.20.0/bin:$PATH
cd /opt/smarttasks
git pull --ff-only
# Env-Check (#797): Key-Namen aus .env.example (Vertrag) gegen Environment= der
# systemd-Unit. Fehlt ein Pflicht-Key → Abbruch vor Build/Restart (set -e),
# der Dienst laeuft auf dem alten Stand weiter. Werte werden nie ausgegeben.
sh scripts/env-check.sh .env.example --systemd smarttasks.service
npm install --no-audit --no-fund
# server npm (10.x) rewrites the npm-11 lockfile; keep the tree clean for the next pull
git checkout -- package-lock.json
npm run build
# sudoers erlaubt `deploy` nur WOERTLICH `/usr/bin/systemctl restart smarttasks`
# (ohne .service, sonst Passwort-Prompt und kein Neustart, #803). -n: sofort
# scheitern statt auf ein Passwort zu warten.
sudo -n /usr/bin/systemctl restart smarttasks
sleep 2
systemctl is-active smarttasks.service
curl -sf -o /dev/null localhost:3020/login && echo "deploy ok: $(git log --oneline -1)"
