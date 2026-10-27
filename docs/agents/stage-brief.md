# Stage brief

The orchestrator pastes this into every stage brief, after the stage line, the worktree path, branch and base SHA, and the one output the stage may write.

## Before you start

- Check `pwd`, `git branch --show-current` and `git rev-parse HEAD` against the brief. If any of them differs, stop and report BLOCKED.
- Write only the output this brief names. If a skill's instructions conflict with this brief on safety, writes or verification, stop and report the conflict.
- Never route around a hook, guard or permission denial, for example by shelling out. Stop and report the refusal.
- Don't commit unless you are SHIP. If a Stop hook asks for a commit, reply that the work stays uncommitted until SHIP, and end the turn.

## Setup

- `npm run setup:local` writes this worktree's `.env`, then run `npm run db:migrate`. Run migrate again after pulling a migration.
- Cloud session: the SessionStart hook starts `dockerd`, unsets the cloud database vars, and installs dependencies and Playwright chromium. If `env | grep DATABASE_URL` still shows a value, prefix each command with `env -u DATABASE_URL -u SUPABASE_URL -u VITE_SUPABASE_URL -u VITE_SUPABASE_PUBLISHABLE_KEY -u SUPABASE_PUBLISHABLE_KEY -u SUPABASE_SECRET_KEY`. If Node is older than 24, the `EBADENGINE` warning is fine, but name the Node version in the evidence.
- `Invalid login credentials` from every server suite means another checkout reset the shared test user. Rerun `npm run setup:local` here. Don't read other checkouts' `.env` files.
- Before `npm run e2e`, check `lsof -iTCP:8787 -iTCP:5173 -sTCP:LISTEN`. A server already listening may belong to another worktree.

## Tests

- Every AC and owner Decision gets at least one test that fails before the change. Add error-path tests where a Decision names a failure. Add no tests for behaviour that no AC or Decision mentions.
- Watch each new test fail first, the e2e included. For a wiring test, remove the call and quote the failure.
- When a result depends on several inputs the cook can set (Main unit, Conversion, Batch Scale, Fixed or Vague), test at least one case for each pair of inputs that meet in the code. Sums include an amount that isn't exact in binary, such as 0.1 × 3.
- In e2e tests, wait for the `/api/mutate` response before any `reload()` or assertion about persistence. Prove the test goes red by delaying that route with `page.route`.
- Web logic that a test should cover goes in `shared/` or a pure `web/src` module with a vitest test next to it. Components only render.
- To run one file: `npm test -w <shared|server> -- <path> -t "<name>"`. Logs go in the session scratchpad. The browser check is the Playwright e2e (no chrome-devtools MCP).

## Evidence

One row per AC: command, exit status, short quoted output, and `PASS | FAIL | NOT RUN | BLOCKED`. Quote the SHA the commands ran at, and both `npm test` totals (shared and server). A claim like "created" or "linked" quotes the command and the API's answer.

## Code

- Lock a parent row that other tables reference with `.for("no key update")`, not `FOR UPDATE`. Prove a lock change with a two-connection test that fails with "deadlock detected" before the fix.
- To export a private helper, export a narrowed wrapper with only the options the new caller needs.
