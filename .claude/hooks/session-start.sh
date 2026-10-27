#!/bin/bash
# Cloud sessions only: Docker for the local Supabase stack, the Playwright browser the e2e
# pins, the npm dependencies, and an env without the session's cloud database values, so
# `npm run setup:local` and the tests use the local .env (CODING_STANDARDS.md).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# setup:local and every test refuse cloud URLs (assertLocalEnv in scripts/).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'unset DATABASE_URL SUPABASE_URL VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY' >> "$CLAUDE_ENV_FILE"
fi

if ! docker info >/dev/null 2>&1; then
  nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 60); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null 2>&1 || { echo "dockerd did not start; see /tmp/dockerd.log" >&2; exit 1; }
fi

# npm ci, not npm install: it never rewrites package-lock.json, so the tree stays clean.
npm ci --no-audit --no-fund

# The image's browsers may not match the pinned @playwright/test; this is a no-op when they do.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 npx playwright install chromium
