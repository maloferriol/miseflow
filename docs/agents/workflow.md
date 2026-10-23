# Ticket workflow

How a ticket goes from issue to PR here: branches, worktrees, tests, plans, reviews. Put the rules a subagent needs into its brief; it won't read this file by itself.

## Branches

- `main` is the integration branch. Every ticket PR targets `main`.
- A ticket whose dependency is still unmerged is **stacked**: cut its branch from that ticket's branch, start the PR body with `Stacked on #<PR>`, and merge the stack bottom first.
- The base comes from the issue thread. Its latest `Base:` comment overrides the Plan and any earlier comment. If no `Base:` comment exists, ask.
- Before starting a ticket, look for earlier work on it: `git worktree list`, `git branch -a --list '*ticket/<n>-*'`, then `git log origin/main..<branch>`. Resume that branch rather than starting again.
- When you resume or hand off, say where things stand from `git log` and `git status`. Notes and memory go stale.

## A new worktree

1. Enter it with `EnterWorktree(path)` before editing. A hook blocks Write and Edit outside the session's starting worktree.
2. Run `npm run setup:local` there. It writes the worktree's own local `.env`. The main checkout's `.env` may hold cloud values, and every test refuses those.
3. Run `npm run db:migrate`, and run it again after pulling a branch that adds a migration.

## Tests

- **Ports first.** `npm run e2e` reuses any server already listening on :8787 or :5173, which may be serving another worktree. Check with `lsof -iTCP:8787 -iTCP:5173 -sTCP:LISTEN`, and stop that server or run the e2e from the worktree that owns it.
- **One file:** `npm test -w <shared|server> -- <path relative to that workspace> -t "<name>"`. Run from the root without `-w`, vitest reports "no tests" or `ECONNREFUSED ::1:5432`.
- **Totals:** `npm test` prints one block per workspace. Report both: shared files/tests and server files/tests.
- **Red first.** Watch every new test fail before the code makes it pass. That includes the e2e, so write it before the web step. For a wiring test (an edit triggers a re-plan, reconcile and so on), remove the call, run the test, and quote the failure. A wiring test that passes without its call proves nothing.
- Logs and test output go in the session scratchpad.
- The chrome-devtools MCP isn't configured here. The Playwright e2e is the browser check.
- The repo has no CI (#105). The PR's evidence is the local run: commands and their quoted totals.

## Plans

- The Plan is a comment on the issue. Write no `tasks/plan.md` or other plan files in the repo.
- A Plan-type agent can't write files. Have it return the Plan as text, and post it yourself.
- Numbers in a Plan (placements, times, due times) are illustrative. Tests get their expected values from a real run of the code, such as `schedule()`. Hand-worked placements in #86's Plan were wrong.
- ADR 0004's walkthrough ("Done looks like") is the fixture's source of truth, wording included. Match it. If an AC seems to need something else, put that under the Plan's Needs the owner list and recommend the walkthrough.
- Plan only what the ACs ask for. Anything extra goes under Needs the owner as a question.

## Code and review

- **Row locks.** Lock a parent row that other tables reference by foreign key with `.for("no key update")`. An insert into a child row takes KEY SHARE on its parent, and that conflicts with `FOR UPDATE`. This deadlocked in #84's review and again in #87. Prove a lock change with a two-connection test that is red ("deadlock detected") before the fix.
- **Should-fix on a shared primitive.** If a review finds one in something other tickets call (`lockRecipe`, `requireOwned`, the scheduler), either fix it in the PR or open an issue for it before shipping. Left as a note, #84's deadlock came back in #87.
