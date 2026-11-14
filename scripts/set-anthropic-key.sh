#!/usr/bin/env bash
# Saves ANTHROPIC_API_KEY into .env (prompting without echoing it) and restarts the production server on :3000.
# The ngrok tunnel keeps running; it reconnects to the new server automatically.
set -euo pipefail
cd "$(dirname "$0")/.."

read -rsp "Paste your Anthropic API key (input hidden): " KEY
echo
if [[ ! "$KEY" =~ ^sk-ant- ]]; then
  echo "That doesn't look like an Anthropic key (expected it to start with sk-ant-). Nothing changed." >&2
  exit 1
fi

touch .env
tmp=$(mktemp)
grep -v -E '^[[:space:]]*ANTHROPIC_API_KEY[[:space:]]*=' .env > "$tmp" || true
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> "$tmp"
mv "$tmp" .env
chmod 600 .env
unset KEY
echo "Saved ANTHROPIC_API_KEY to .env"

lsof -ti:3000 | xargs kill -9 2>/dev/null || true
nohup npm run -s start > /tmp/hermit-server.log 2>&1 &
for _ in $(seq 1 30); do
  curl -s -o /dev/null http://localhost:3000 && break
  sleep 1
done

if curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 | grep -q 200; then
  echo "Server restarted on http://localhost:3000 (log: /tmp/hermit-server.log). The Claude planner is now active."
else
  echo "Server didn't come back up; check /tmp/hermit-server.log" >&2
  exit 1
fi
