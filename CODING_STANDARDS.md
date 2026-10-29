# Coding standards

Repo facts for anyone writing or reviewing code here. `code-review` checks the diff against this file.

- Never route around a hook, guard or permission denial, for example by shelling out. Stop and report the refusal.

## Setup

- In a new worktree, run `npm run preflight` (it checks Node, Docker, the local stack and the app ports, installs dependencies, and runs `npm run setup:local` to write this worktree's `.env.test`), then `npm run db:migrate`. Run migrate again after pulling a migration.
- Preflight doesn't check Claude skills: a session needs the `mattpocock-skills` plugin installed in the user's Claude config.
- Cloud session: the SessionStart hook starts `dockerd`, unsets the prod database vars, and installs dependencies and Playwright chromium. If `env | grep DATABASE_URL` still shows a value, prefix each command with `env -u DATABASE_URL -u SUPABASE_URL -u VITE_SUPABASE_URL -u VITE_SUPABASE_PUBLISHABLE_KEY -u SUPABASE_PUBLISHABLE_KEY -u SUPABASE_SECRET_KEY`. Node older than 24 only warns (`EBADENGINE`).
- Each checkout signs in as its own test user with a fresh password per run, held in memory (`scripts/test-user.ts`); `npm run dev:user` prints it. Don't read other checkouts' `.env.test` files.
- Agent sessions start `npm run dev:server` and `npm run dev:web` with the Bash tool's `run_in_background`, never detached with `&`, `nohup` or `( … &)`, and stop them with TaskStop before ending the turn. A detached server can't be stopped later: the permission check refuses `kill` and `pkill`, because it can't tell who started the process. #165 tracks a scoped `dev:stop` and a cleanup hook.
- `npm run e2e` starts its own API and web app on free ports it picks for the run, so it can run while dev servers or another worktree's e2e hold 8787 and 5173. Specs call the API through `apiUrl(path)` from `scripts/e2e-ports.ts`, never a `localhost` URL.
- Each e2e spec signs in with `createTestUser()` and calls `deleteTestUser()` in `afterAll`, which hard-deletes every row that user owns. A user's email names its run's runner pid, so a run's setup sweeps only the users of runs that have ended. Every row a spec writes needs that user as owner: the global teardown fails the run when an e2e user's rows are left or the rows with no owner changed.

## Tests

- Watch each new test fail first, the e2e included. For a wiring test, remove the call and quote the failure.
- Expected values come from a real run of the code, not from hand-worked numbers. ADR 0004's walkthrough ("Done looks like") is the fixture's source of truth, wording included.
- When a result depends on several inputs the cook can set (Main unit, Conversion, Batch Scale, Fixed or Vague), test at least one case for each pair of inputs that meet in the code. Sums include an amount that isn't exact in binary, such as 0.1 × 3.
- In e2e tests, wait for the `/api/mutate` response before any `reload()` or assertion about persistence. Prove the test goes red by delaying that route with `page.route`.
- Web logic that a test should cover goes in `shared/` or a pure `web/src` module with a vitest test next to it: decisions, validation, formatting, and each mutation's name and args. A `useState` that only holds what the cook typed, or a value set once on open, can stay in the component. No reducers.
- A screen with branches to test is split into core, hook and view (ADR 0011). The hook calls `useQuery`, `useMutation`, `useIntent` and `useQueryClient`, and may hold the typed-text and set-once state: if it grows a branch, move the branch into the core. When nested parts each need their own mutation, give each part its own hook, and pass the nested part to the parent view as a `render…` slot prop (`renderCourse`). The view takes props only.
- View tests are `*.test.tsx` under jsdom. They find elements by role and visible text, check what callbacks are called with, and use no snapshots. Props for loading, error and pending states can be written by hand. A prop that holds a computed value comes from the walkthrough or a core function.
- Hook and wired tests are `*.test.tsx` under jsdom too. Render the hook with `renderQueryHook()` and the hook plus view with `renderWired()` (`web/test/render-view.tsx`), which give each test a fresh, real QueryClient with `retry: false`. Fake only two modules, each through `vi.mock` with a factory: `./api.ts`, and `./supabase.ts` for the app shell and sign-in, which talk to Supabase auth directly (`web/src/App.test.tsx`). Check what callers see: the values the hook returns, each mutation's name and args, and invalidations (`isInvalidated`, or a refetch when the query is live). Examples: `web/src/StepEditor.test.tsx`, the "Link choice hook" block in `web/src/LinkChoice.test.tsx`, `web/src/MenuScreen.test.tsx`.
- To run one file: `npm test -w <shared|server> -- <path> -t "<name>"`. `npm test` prints separate shared and server totals. The browser check is the Playwright e2e (no chrome-devtools MCP).

## Code

- Lock a parent row that other tables reference with `.for("no key update")`, not `FOR UPDATE`. Prove a lock change with a two-connection test that fails with "deadlock detected" before the fix.
- To export a private helper, export a narrowed wrapper with only the options the new caller needs.

## CI

- Before opening a PR, run `npm run check`: it runs CI's blocking steps locally and says whether CI would pass (README "Local development").
- Run `npm run format` and `npm run lint` before committing. CI checks formatting first, then lint, and fails on any file Prettier would change or any ESLint error.
- Lint rules live in `eslint.config.js`. Fix the code rather than switching a rule off. A disable comment names the rule and says on the line above why the rule is wrong there.
- CI (`.github/workflows/ci.yml`) runs the format check, lint, typecheck, build, `npm run test:coverage`, the e2e and the SonarCloud gate, in three parallel jobs: `static`, `test` (the gate runs after the tests) and `e2e`. The e2e step is non-blocking: it retries once, reports failures and flaky tests, and uploads the HTML and JSON reports, but can't fail the `check` job. It becomes required after 20 runs in a row on `main` with no failure and no flaky test. The `main: require CI check` ruleset blocks merging until the `check` job passes; it passes only when every blocking job does, so a new blocking job goes in its `needs`.
- Pin each third-party action to its full commit SHA, with the tag in a comment. Keep `--ignore-scripts` on `npm ci`. Keep SonarCloud's Automatic Analysis off.
