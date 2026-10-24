# Ticket workflow

How a ticket goes from issue to PR here: branches, worktrees, tests, plans, reviews. Put the rules a subagent needs into its brief; it won't read this file by itself.

## Running the stages

- **The main session orchestrates.** A subagent can't spawn subagents, so a "ticket orchestrator" subagent that delegates stages stalls (#91). The main session runs each stage (DEFINE, PLAN, BUILD, VERIFY, REVIEW, SHIP, RETRO) as its own subagent, with one common brief plus a stage line.
- If the `/addy:*` commands aren't installed, emulate each stage from the common brief. Say so in the PR.
- Each stage writes its output and logs under `scratchpad/<n>/` (`spec.md`, `build/`, `verify/`, `review.md`). The next stage's brief points at those paths.
- **Commits.** Only SHIP commits and pushes. If a Stop hook asks for a commit in an earlier stage, don't commit. Reply that the work is uncommitted on purpose until SHIP, and end the turn.

## Branches

- `main` is the integration branch. Every ticket PR targets `main`.
- **Cloud sessions** (claude.ai/code) push only to the session's own `claude/...` branch. There, that branch replaces `ticket/<n>-*`. The Plan's `Base:` names the base commit, not the branch name. When looking for earlier work, also check `git branch -a --list 'claude/*'` and the PRs that link the issue.
- A ticket whose dependency is still unmerged is **stacked**: cut its branch from that ticket's branch, start the PR body with `Stacked on #<PR>`, and merge the stack bottom first.
- The base comes from the issue thread. Its latest `Base:` comment overrides the Plan and any earlier comment. If no `Base:` comment exists, ask.
- Before starting a ticket, look for earlier work on it: `git worktree list`, `git branch -a --list '*ticket/<n>-*'`, then `git log origin/main..<branch>`. Resume that branch rather than starting again.
- When you resume or hand off, say where things stand from `git log` and `git status`. Notes and memory go stale.

## A new worktree

1. Enter it with `EnterWorktree(path)` before editing. A hook blocks Write and Edit outside the session's starting worktree.
2. Run `npm run setup:local` there. It writes the worktree's own local `.env`. The main checkout's `.env` may hold cloud values, and every test refuses those.
3. Run `npm run db:migrate`, and run it again after pulling a branch that adds a migration.

## A cloud session

The session env holds cloud `DATABASE_URL`/`SUPABASE_*` values. `setup:local` and every test refuse them. The SessionStart hook (`.claude/hooks/session-start.sh`) runs only in cloud sessions and handles the setup #91 had to find by hand:

1. It starts `dockerd` if `docker info` fails.
2. It unsets the cloud vars for every later Bash command (through `$CLAUDE_ENV_FILE`), so the local `.env` applies.
3. It runs `npm ci` and installs the Playwright chromium that the pinned `@playwright/test` needs.

Then run `npm run setup:local` and `npm run db:migrate` as usual. If the hook didn't run (`env | grep DATABASE_URL` still shows a value, or `docker info` fails), do those steps by hand. To unset the vars yourself, prefix each command with `env -u DATABASE_URL -u SUPABASE_URL -u VITE_SUPABASE_URL -u VITE_SUPABASE_PUBLISHABLE_KEY -u SUPABASE_PUBLISHABLE_KEY -u SUPABASE_SECRET_KEY`.

Also:

1. Node may be older than the `>=24` in `engines` (#91 ran v22). `EBADENGINE` is a warning. Say in the PR which Node version ran the tests.
2. Registry pulls during `supabase start` can print `Data limit exceeded` and retry. That's transient unless `setup:local` exits non-zero.

Put these steps in every BUILD, VERIFY and REVIEW brief. A subagent doesn't read this file.

## Tests

- **Ports first.** `npm run e2e` reuses any server already listening on :8787 or :5173, which may be serving another worktree. Check with `lsof -iTCP:8787 -iTCP:5173 -sTCP:LISTEN`, and stop that server or run the e2e from the worktree that owns it.
- **One file:** `npm test -w <shared|server> -- <path relative to that workspace> -t "<name>"`. Run from the root without `-w`, vitest reports "no tests" or `ECONNREFUSED ::1:5432`.
- **Totals:** `npm test` prints one block per workspace. Report both: shared files/tests and server files/tests.
- **Red first.** Watch every new test fail before the code makes it pass. That includes the e2e, so write it before the web step. For a wiring test (an edit triggers a re-plan, reconcile and so on), remove the call, run the test, and quote the failure. A wiring test that passes without its call proves nothing.
- **Combinations, not just cases.** When a function's result depends on several inputs the cook can set (an override Main unit, a Conversion, a Batch Scale factor, Fixed or Vague), list the paths in the Plan as a small grid, and test at least one case per pair that meets in the code. One test per input alone missed #91's B1: an override Main unit of kg with an `each→g` Conversion gave "needs conversion".
- Include a value that isn't exact in binary (0.1 × 3) in a test that sums amounts. Float noise ("300.00000000000006 g") reached #91's display because every fixture amount was exact.
- **E2e and optimistic UI.** The web app updates before the server answers, so an assertion right after a click proves only local state. Before a `reload()` or any assertion meant to prove persistence, wait for the mutation's response, for example `Promise.all([page.waitForResponse(r => r.url().endsWith("/api/mutate") && r.request().method() === "POST" && r.ok()), box.check()])`. Show the test going red by delaying `/api/mutate` with `page.route`, not by repeat runs. Three green runs hid #91's race.
- The `web` workspace has no unit-test runner. Put any logic the web needs that a test should cover (number formatting, the ≈ prefix, grouping) in `shared/` as a pure function with a vitest test, and keep `web/` to rendering. If it must stay in `web/`, cover it in the e2e, or list it as untested in the PR.
- Logs and test output go in the session scratchpad.
- The chrome-devtools MCP isn't configured here. The Playwright e2e is the browser check.
- The repo has no CI (#105). The PR's evidence is the local run: commands and their quoted totals.

## Plans

- The Plan is a comment on the issue. Write no `tasks/plan.md` or other plan files in the repo.
- A Plan-type agent can't write files. Have it return the Plan as text, and post it yourself.
- Numbers in a Plan (placements, times, due times) are illustrative. Tests get their expected values from a real run of the code, such as `schedule()`. Hand-worked placements in #86's Plan were wrong.
- ADR 0004's walkthrough ("Done looks like") is the fixture's source of truth, wording included. Match it. If an AC seems to need something else, put that under the Plan's Needs the owner list and recommend the walkthrough.
- Plan only what the ACs ask for. Anything extra goes under Needs the owner as a question.
- **Dependencies.** For each other ticket, name what overlaps and pick one:
  - **Blocks:** this ticket calls code, schema or fixtures that the other ticket adds or changes. Stack on it.
  - **Touches the same file:** both add or edit a file, but neither needs the other's content. Base on `main`, and let the second merge resolve the conflict.

  Only "Blocks" justifies "start after #n". #91's Plan called a shared new `print.css` a blocker, and the owner had to unblock it.
- **Needs the owner.** Before adding a question, check whether an AC, ADR, `CONTEXT.md` or the units spec already answers it. If one does, cite it and plan to it. Give every remaining question a recommended answer and a one-line reason, so the owner can reply "as recommended" or list exceptions.
- Open questions block DEFINE. Post the Plan, then stop and tell the owner the count. Restart from the owner's answer comment. After the answers, post a **Plan addendum** that replaces the Plan where they differ and ends with "Needs the owner: None". #91 followed this pattern.

## Code and review

- **Row locks.** Lock a parent row that other tables reference by foreign key with `.for("no key update")`. An insert into a child row takes KEY SHARE on its parent, and that conflicts with `FOR UPDATE`. This deadlocked in #84's review and again in #87. Prove a lock change with a two-connection test that is red ("deadlock detected") before the fix.
- **Should-fix on a shared primitive.** If a review finds one in something other tickets call (`lockRecipe`, `requireOwned`, the scheduler), either fix it in the PR or open an issue for it before shipping. Left as a note, #84's deadlock came back in #87.
- **Exporting a helper.** Making a private helper public (or reaching it through an `export *`) makes it a shared primitive. Export a narrowed wrapper with only the options the new caller needs, not the helper with its lock or other options. #91 exported `findService` and its FOR UPDATE option with it, and REVIEW sent it back.
