# Ticket orchestrator

How an orchestrator takes a ticket from issue to merged PR. Stage subagents don't read this file: give each one `docs/agents/stage-brief.md` plus a stage line.

## Stages

| Stage | Output | Skill | Model |
|---|---|---|---|
| DEFINE | `spec.md`: ACs, open questions, Needs the owner | none | default |
| PLAN | Plan comment on the issue | none | default |
| BUILD | code and tests in the worktree, uncommitted | `mattpocock-skills:tdd` | default |
| VERIFY | `verify/`: the evidence table at the worktree's HEAD | none | haiku |
| REVIEW | `review.md`: verdict and findings, pinned to a SHA | `mattpocock-skills:code-review` | default |
| SHIP | commit, push, PR, follow-up issues | `mattpocock-skills:pr` | default; `gh` steps on haiku |
| RETRO | rule changes proposed as a comment on the issue | none | default |

- Run each stage as its own background subagent. Its result reaches you as a message on your next turn. Your reports between stages are interim. Only the report you send once no stage is running is final.
- Stage outputs go under the session scratchpad's `<n>/`. The next brief points at those paths.
- Start every write stage with its working directory set to the target worktree.
- A brief names the stage's only permitted output, and it beats a skill's default outputs. Load only the skill listed for the stage.
- Resume from `git log`, `git status` and the issue thread, not from notes or memory.

## Branches

- Every ticket PR targets `main`. A branch is `ticket/<n>-<slug>`. In a cloud session, use the session's own `claude/...` branch instead.
- The base comes from the issue's latest `Base:` comment. If there isn't one, ask. If the ticket depends on unmerged work, stack it: cut its branch from that ticket's branch, start the PR body with `Stacked on #<PR>`, and merge the stack bottom first.
- Before starting, look for earlier work with `git worktree list`, `git branch -a --list '*ticket/<n>-*' 'claude/*'` and the PRs linked to the issue, and resume it.
- New worktree: `npm run setup:local`, then `npm run db:migrate`.

## Plans

- The Plan is a comment on the issue. There are no plan files in the repo. A Plan-type agent returns the Plan as text, and you post it.
- Plan only what the ACs ask for. ADR 0004's walkthrough ("Done looks like") is the fixture's source of truth, wording included. Numbers in a Plan are illustrative: tests take their expected values from a real run.
- For each other ticket that overlaps, write **Blocks** (this ticket uses its code, schema or fixtures, so stack on it) or **Touches the same file** (base on `main`, and the second to merge resolves the conflict). Only Blocks justifies waiting.
- **Escalate** anything that changes a schema, an ADR or an AC, spends money, or needs an account, a token, a secret or a repo setting. No agent creates accounts or enters tokens. **Decide everything else and log it** in a `## Decisions` block on the issue before code is written.
- Check whether an AC, an ADR, `CONTEXT.md` or a spec already answers a question before escalating it. Give each escalated question a recommended answer and a one-line reason.
- Open questions, including ones already listed in the issue, block DEFINE. Post the Plan, stop, and tell the owner how many there are. After the owner answers, post a Plan addendum that ends with "Needs the owner: None".
- Owner-only steps ship as a separate issue with steps and "Done when", so the PR can ship the rest. Suggest wording a `/goal` as "PR merged, owner steps filed".

## Review loop and merge gate

- A review verdict is valid only for the SHA it reviewed. Moved commits need a delta review.
- Each review round gets the previous round's report. After 2 fix rounds, file an issue for what's left, then ship or block explicitly.
- A change to a Decision, an AC or a Plan number edits that issue comment in the same turn as the code.
- Every finding left unfixed becomes a `gh issue create`, linked in the verdict.
- Merging needs a review verdict and VERIFY evidence on the PR head SHA. SHIP stops if the evidence SHA isn't the pushed head. If a stack deeper than 1 touches shared files, the owner decides.

## CI and GitHub

- Only SHIP commits and pushes. Each push cancels the running CI (about 5 minutes), so batch fixes into one push.
- CI (`.github/workflows/ci.yml`) runs typecheck, build, `npm run test:coverage` and the SonarCloud gate, but not the e2e. The `main: require CI check` ruleset blocks merging until the `check` job passes.
- SonarCloud analyzes workflow code. Pin each third-party action to its full commit SHA, with the tag in a comment. Keep `--ignore-scripts` on `npm ci`. Keep SonarCloud's Automatic Analysis off.
