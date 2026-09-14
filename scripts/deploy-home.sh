#!/usr/bin/env bash
# deploy-home.sh — Deploy Tasklog to the hydramachine home server (old Dell laptop).
#
# Builds locally and transfers over LAN. The backend is published SELF-CONTAINED
# (bundles the .NET runtime), so the server needs no dotnet install. The systemd
# units are regenerated on every deploy (config-as-code: env lives here, not in
# hand-edited files on the server). The live database is preserved on swap;
# rollback copies kept as backend-old / frontend-old.
#
# Prereqs: dotnet SDK + node/npm locally; SSH key auth to the server.
# Usage (from repo root):  ./scripts/deploy-home.sh
#
# Override host via env if the address changes:
#   HOME_HOST=hydra@192.168.1.50 ./scripts/deploy-home.sh
# Default is the domain: it carries A records for both the ethernet (.49) and
# wifi (.50) reservations, so it works in either connectivity scenario.

set -euo pipefail

HOST="${HOME_HOST:-hydra@tasklog.home.manudubey.in}"
# Empty default = relative same-origin API calls. Caddy on :80 routes /api/*
# to the backend (companion/doppel stay on Next), so ANY hostname the server
# is reached by (IP, tasklog.home, Tailscale) works without a rebuild.
API_URL="${TASKLOG_API_URL:-}"
T="/home/hydra/tasklog"
SERVER_TZ="Asia/Kolkata"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

step(){ printf "\n\033[36m== %s ==\033[0m\n" "$1"; }

step "Build backend (linux-x64, self-contained)"
dotnet publish backend/Tasklog.Api -c Release -r linux-x64 --self-contained \
  -o backend/Tasklog.Api/bin/publish/linux-x64-sc

step "Build frontend (API_URL=$API_URL)"
NEXT_PUBLIC_API_URL="$API_URL" npm run build --prefix frontend

step "Write systemd units (config-as-code)"
ssh "$HOST" "sudo tee /etc/systemd/system/tasklog-api.service > /dev/null" <<EOF
[Unit]
Description=Tasklog API (home)
After=network-online.target

[Service]
User=hydra
WorkingDirectory=$T/backend
ExecStart=$T/backend/Tasklog.Api
Environment=ASPNETCORE_URLS=http://0.0.0.0:5115
Environment=TZ=$SERVER_TZ
Environment=Ollama__Url=http://127.0.0.1:11434
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

ssh "$HOST" "sudo tee /etc/systemd/system/tasklog-frontend.service > /dev/null" <<EOF
[Unit]
Description=Tasklog frontend (home)
After=network-online.target tasklog-api.service

[Service]
User=hydra
WorkingDirectory=$T/frontend
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Environment=TZ=$SERVER_TZ
Environment=COMPANION_ENABLED=1
Environment=API_URL=http://localhost:5115
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

step "Stop services (tolerated on first deploy)"
ssh "$HOST" "sudo systemctl daemon-reload; sudo systemctl stop tasklog-api tasklog-frontend 2>/dev/null || true"

step "Stage backend"
ssh "$HOST" "rm -rf $T/backend-new; mkdir -p $T/backend-new"
scp -q -r backend/Tasklog.Api/bin/publish/linux-x64-sc/. "$HOST:$T/backend-new/"

step "Stage frontend"
ssh "$HOST" "rm -rf $T/frontend-new; mkdir -p $T/frontend-new"
scp -q -r frontend/.next/standalone/.     "$HOST:$T/frontend-new/"
scp -q -r frontend/.next/standalone/.next "$HOST:$T/frontend-new/"
scp -q -r frontend/.next/static           "$HOST:$T/frontend-new/.next/"
scp -q -r frontend/public                 "$HOST:$T/frontend-new/"
# the Agent SDK's native CLI binary is an optional package the standalone tracer
# misses; without it the companion route dies with "Native CLI binary not found"
scp -q -r frontend/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64 \
  "$HOST:$T/frontend-new/node_modules/@anthropic-ai/"

step "Swap in new build + restart (DB preserved)"
ssh "$HOST" 'bash -s' <<'REMOTE'
set -e
T=/home/hydra/tasklog
# preserve the live database into the new backend before swapping
cp -f "$T/backend/TasklogDatabase.db" "$T/backend-new/TasklogDatabase.db" 2>/dev/null || true
rm -rf "$T/backend-old"
if [ -d "$T/backend" ]; then mv "$T/backend" "$T/backend-old"; fi
mv "$T/backend-new" "$T/backend"
rm -rf "$T/frontend-old"
if [ -d "$T/frontend" ]; then mv "$T/frontend" "$T/frontend-old"; fi
mv "$T/frontend-new" "$T/frontend"
chmod +x "$T/backend/Tasklog.Api"
sudo systemctl enable --now tasklog-api tasklog-frontend > /dev/null 2>&1
sudo systemctl restart tasklog-api tasklog-frontend
# first start on the HDD can take >10s (self-contained .NET + EF ensure-created)
sleep 15
echo -n "api: "; systemctl is-active tasklog-api
echo -n "frontend: "; systemctl is-active tasklog-frontend
REMOTE

step "Verify"
curl -s -o /dev/null -w "frontend http://192.168.1.49:3000 -> %{http_code}\n" "http://192.168.1.49:3000/"
curl -s -o /dev/null -w "api      http://192.168.1.49:5115/api/projects -> %{http_code}\n" "http://192.168.1.49:5115/api/projects"
curl -s -o /dev/null -w "caddy    http://192.168.1.49/ -> %{http_code}\n" "http://192.168.1.49/"
curl -s -o /dev/null -w "caddy    http://192.168.1.49/api/projects -> %{http_code}\n" "http://192.168.1.49/api/projects"
echo "Deploy complete."
