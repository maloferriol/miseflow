#!/bin/bash
# Stops this checkout's dev servers when a session ends, so none keeps the app ports
# (CODING_STANDARDS.md). It never fails the session, and prints nothing when nothing was running.
cd "$CLAUDE_PROJECT_DIR" || exit 0
npm run --silent dev:stop -- --quiet || true
