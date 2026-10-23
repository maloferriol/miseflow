# Ticket workflow

How a ticket goes from issue to PR here: stages, branches, worktrees, tests, plans, reviews. Put the rules a subagent needs into its brief; it won't read this file by itself.

## Stages

- A ticket runs plan → implement → test → review → ship, one subagent per stage. Each stage does its own stage and hands back a report.
- Plan and review are read-only. The Plan's one output is the issue comment; the review's is its verdict. Implement and fix rounds write only in the ticket worktree.
- **The brief wins over a skill's defaults** (`tasks/plan.md`, plan mode, approval prompts). Note the override in one line and carry on. When the conflict touches safety or verification, such as a read-only brief and a skill step that edits a file to check a test, stop and report it.
- **A guard refusal is a stop.** When a hook blocks a write, report `BLOCKED` with the hook's message, and the orchestrator re-dispatches into the right worktree. Writing the file another way (Bash heredoc, `sed`) is exactly what the guard exists to stop.
- **Decide or escalate.** Escalate to the owner: a schema change, an ADR or `CONTEXT.md` change, a change to an AC, anything that spends money or touches the cloud project. Decide everything else and log it under `## Decisions` in the Plan comment before the code is written. In the #79–#83 run, four Plans escalated 53 questions and the owner answered "accept all" three times.
- **Hard limits.** Push only the ticket branch; the owner merges. Propose a diff for `docs/adr/*` and `CONTEXT.md` instead of editing them. Set work aside with a WIP commit, since the stash stack is shared by every worktree.
- **Friction.** End every stage report with a `Friction` list: each place you guessed, skipped a step, or found these docs or the ticket wrong, or "none". The orchestrator posts it on the issue, so it outlives the session.

## Branches

- `main` is the integration branch. Every ticket PR targets `main`.
- A ticket whose dependency is still unmerged is **stacked**: cut its branch from that ticket's branch, start the PR body with `Stacked on #<PR>`, and merge the stack bottom first.
- The base comes from the issue thread. Its latest `Base:` comment overrides the Plan and any earlier comment. If no `Base:` comment exists, ask.
- Before starting a ticket, look for earlier work on it: `git worktree list`, `git branch -a --list '*ticket/<n>-*'`, then `git log origin/main..<branch>`. Resume that branch rather than starting again.
- When you resume or hand off, say where things stand from `git log` and `git status`. Notes and memory go stale.

## A new worktree

1. Enter it with `EnterWorktree(path)` before editing. A hook blocks Write and Edit outside the session's starting worktree. A subagent starts in the orchestrator's cwd, whatever path its brief names, so its first command is `pwd && git branch --show-current && git rev-parse --short HEAD`. If any of them differs from the brief, it stops and reports.
2. Run `npm run setup:local` there. It writes the worktree's own local `.env`. The main checkout's `.env` may hold cloud values, and every test refuses those.
3. Run `npm run db:migrate`, and run it again after pulling a branch that adds a migration.

## Tests

- **Ports first.** `npm run e2e` reuses any server already listening on :8787 or :5173, which may be serving another worktree. Check with `lsof -iTCP:8787 -iTCP:5173 -sTCP:LISTEN`, and stop that server or run the e2e from the worktree that owns it.
- **One file:** `npm test -w <shared|server> -- <path relative to that workspace> -t "<name>"`. Run from the root without `-w`, vitest reports "no tests" or `ECONNREFUSED ::1:5432`.
- **Totals:** `npm test` prints one block per workspace. Report both: shared files/tests and server files/tests.
- **Red first.** Watch every new test fail before the code makes it pass. That includes the e2e, so write it before the web step. For a wiring test (an edit triggers a re-plan, reconcile and so on), remove the call, run the test, and quote the failure. A wiring test that passes without its call proves nothing.
- **Test floor.** Every AC and every owner Decision gets at least one test that goes red before the change. Add an error-path test where a Decision names a failure mode. Test only behaviour an AC or a Decision names.
- Logs and test output go in the session scratchpad.
- The chrome-devtools MCP isn't configured here. The Playwright e2e is the browser check.
- **Evidence is pinned to a SHA.** The repo has no CI (#105), so the PR's evidence is the local run. A test or review report names the commit it ran on and gives, per AC: the command, its exit code, the quoted totals, and `PASS`, `FAIL`, `NOT RUN` or `BLOCKED`. Done is `npm run typecheck`, `npm test` and `npm run e2e` green at the PR's head SHA, with that evidence in the PR body. A commit after the review needs a review of the delta, and ship checks that the evidence SHA is the pushed SHA.

## Plans

- The Plan is a comment on the issue. Write no `tasks/plan.md` or other plan files in the repo.
- A Plan-type agent can't write files. Have it return the Plan as text, and post it yourself.
- Numbers in a Plan (placements, times, due times) are illustrative. Tests get their expected values from a real run of the code, such as `schedule()`. Hand-worked placements in #86's Plan were wrong.
- ADR 0004's walkthrough ("Done looks like") is the fixture's source of truth, wording included. Match it. If an AC seems to need something else, put that under the Plan's Needs the owner list and recommend the walkthrough.
- Plan only what the ACs ask for. Anything extra goes under Needs the owner as a question.
- **Amend in the same turn.** When the code changes a Decision, an AC or a number in the Plan, edit the issue comment in the same turn as the commit. Review checks the Plan against the code. #86's Plan still said "exactly 1 write" after the code moved 2 rows.

## Code and review

- **Row locks.** Lock a parent row that other tables reference by foreign key with `.for("no key update")`. An insert into a child row takes KEY SHARE on its parent, and that conflicts with `FOR UPDATE`. This deadlocked in #84's review and again in #87. Prove a lock change with a two-connection test that is red ("deadlock detected") before the fix.
- **Unfixed findings become issues.** Fix each review finding in the PR, or open an issue for it with `gh issue create` before the verdict is posted, and link it from the verdict. This matters most in something other tickets call (`lockRecipe`, `requireOwned`, the scheduler): left as a note, #84's deadlock came back in #87.
- **Two fix rounds.** Each review round gets the previous round's report. After two fix rounds, what's left becomes issues and the PR ships, unless the owner blocks it. #79 took five rounds, and rounds 3 and 4 each brought a new defect.
