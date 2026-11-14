#!/usr/bin/env bash
# Saves GEMINI_API_KEY into .env (input hidden). Gemini CLI and the Hermit app both read it from there.
# Get a key at https://aistudio.google.com/apikey
set -euo pipefail
cd "$(dirname "$0")/.."

read -rsp "Paste your Gemini API key (input hidden): " KEY
echo
if [[ ! "$KEY" =~ ^[A-Za-z0-9_-]{30,}$ ]]; then
  echo "That doesn't look like a Gemini API key. Nothing changed." >&2
  exit 1
fi

ENV=$(readlink -f .env 2>/dev/null || echo .env)
touch "$ENV"
tmp=$(mktemp)
grep -v -E '^[[:space:]]*GEMINI_API_KEY[[:space:]]*=' "$ENV" > "$tmp" || true
printf 'GEMINI_API_KEY=%s\n' "$KEY" >> "$tmp"
cat "$tmp" > "$ENV" && rm -f "$tmp"
chmod 600 "$ENV"
unset KEY
echo "Saved GEMINI_API_KEY to $ENV"
echo "Restart the Hermit dev server so the app picks it up; Gemini CLI reads it on its next start."
