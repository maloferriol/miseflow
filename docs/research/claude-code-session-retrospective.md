# Retrospective: what the Claude Code sessions say about our prompts and our process

23 Oct 2026 · answers "what is missing in the prompts, and what is missing in the process?" for MiseFlow, over the Claude Code history of 22–23 Oct 2026.

Method: 12 sessions, one review subagent each, run in parallel. Each subagent read a **slimmed** transcript (human turns + assistant text + tool-call skeletons + failure-looking tool output), not the raw JSONL: 37.8 MB → 1.4 MB, 26× smaller. Slimming deduped by `message.id` (43% of lines in the largest transcript were repeats), dropped JSON envelope, attachments and thinking blocks, and redacted keys. Per-session reports: `.claude/agent-outputs/research/retro-s01.md` … `retro-s12.md`. Confidence markers: findings are **(confirmed)** when a quote proves them, **(inferred)** when reasoned from sequence, **(unverified)** when the transcript cannot settle it.

Corpus: 12 sessions · 258 human turns · 1,107 tool calls · 173 findings (82 prompt gaps, 91 process gaps).

| # | Session | What it was | Findings |
|---|---|---|---|
| s01 | merge orchestrator `cce92c0f` | 4 tickets plan→ship, PRs #95/#94/#98/#101 merged | 8 P · 8 G |
| s02 | merge orchestrator `07a0d6da` | #79/#80/#82 shipped, 53 escalated decisions | 12 P · 11 G |
| s03 | merge orchestrator `c87ce7b9` | #85/#84/#86, 3 PRs opened against the wrong base | 9 P · 9 G |
| s04 | merge orchestrator `11ddf52d` | Haiku rule written to the wrong file, self-retro | 3 P · 6 G |
| s05 | wayfinder `7ee59416` | #81 Supabase setup, PR #99 | 5 P · 10 G |
| s06 | ticket #79 `9ed6eebe` | implement fix rounds 2–5, 18 commits | 7 P · 6 G |
| s07 | ticket #80 `26b1b328` | scheduler fix rounds 2–4 + merge | 6 P · 8 G |
| s08 | ticket #82 `f1482f8a` | implement + fix round, invalid e2e gate | 8 P · 8 G |
| s09 | ticket #83 `80438e63` | implement + 5-item review fix round | 8 P · 8 G |
| s10 | ticket #85 `3f16c037` | implement, 15 min, 9 commits | 4 P · 6 G |
| s11 | mvp-tickets `965d53ee` | authored 13 MVP tickets in 12 min | 5 P · 5 G |
| s12 | skills `7dac734a` | built `2bd4c55` and the pipeline prompts | 7 P · 6 G |

## Recommendation

**The pipeline is not in the repo.** That single sentence explains most of the 173 findings.

The stage order, the base branch, the write guard, the done-definition, the escalation threshold, the standing rules and the friction log all live in a **pasted prompt** or in **`/private/tmp` under another session's id**. Every session then pays to restate them, and any session that does not get the paste re-derives them wrongly. Nine of twelve sessions report this independently; s06/s07/s09 all restated the same rules in 4/4 briefs because "nothing in the repo carries them".

Fixing that is a documentation change, not an engineering one — roughly one page in `AGENTS.md` plus moving `RULES.md` into the repo. It is the highest-leverage change available, and it is cheap enough to do today.

## A. What is missing in the prompt

Ranked by how many sessions it cost.

### P1 · The stage contract is never written down (9/12 sessions, HIGH)

s01 P3, s02 PG11, s06 P1, s07 P1/G6, s08 PR-4, s09 PG1, s10 (high G), s11 P1, s12 P1.

The orchestrator's prompt carries the pipeline; the repo carries none of it. Consequences:
- s09: the "local setup + verification contract is not in any repo document, so every brief re-states it".
- s07/s06: the standing rules ("never push", "one commit per item", trailer format) were restated in 4/4 briefs, because `RULES.md` lives at a `/private/tmp` path belonging to another session.
- s10: "RULES.md + friction log + handover live in another session's `/private/tmp` scratchpad … nothing is versioned or survives cleanup."
- s11: the tracer-bullet template, base branch and label rule "exist only in the pasted prompt; `AGENTS.md`/`CLAUDE.md` carry none of it."

**Fix:** one `## Pipeline` section in `AGENTS.md`: stage order, which session/worktree each stage is rooted in, the base branch, the gate command, the done-definition, the escalation threshold, and where the rules file lives. Delete the restated copies from briefs; have briefs reference the section.

### P2 · The integration branch is nowhere (4 sessions, HIGH)

s03 P1, s05 P1, s12, plus s04's open question. s03: "brief said base `feat/mvp-scaffold`; all 3 PRs target `main`". s05: "PR #99 opened against `main`; green tests ran 14 commits behind `feat/mvp-scaffold`". s12: the prompt names the branch, `AGENTS.md` does not.

**Fix:** `AGENTS.md`: "PRs target `feat/mvp-scaffold`. `main` only receives the final merge, by the owner."

### P3 · "Done" is undefined, so each stage invents one (4 sessions, HIGH)

s09 G1: "done = 3 green commands" let a cross-owner write and NaN corruption through. s06 G2: typecheck is not in the gate, so a TS error shipped into a commit and was fixed by rewriting history. s03 G3: tests passed with the wiring deleted. s05 P5: "Severity and PASS are undefined, so reviews invent 'NON-BLOCKING (Required)' and tests PASS with caveats."

**Fix:** `AGENTS.md`: done = `npm run verify` green **at the commit SHA**, plus each acceptance criterion's exact command run and its output pasted into the PR. Review may not approve on another stage's run.

### P4 · "Add no tests beyond what's needed" reads as a ceiling (3 sessions, HIGH)

s08 PG-1: read as a ceiling; the human then added 4 Decision tests that passed first run — no RED. s09 PG2: "add no tests beyond what they need" → 5 fix commits. s02 PG6: read as "do not test error paths", then review ordered the tests anyway.

**Fix:** replace with a floor: "Every acceptance criterion and every owner Decision gets at least one test that fails before the change and passes after. Add error-path tests where a Decision names a failure mode. Do not add tests for behaviour no criterion or Decision mentions."

### P5 · Skills contradict repo conventions and nobody adjudicates (3 sessions, HIGH)

s01 P1: all 6/6 plan stages fought `planning-and-task-breakdown` over `tasks/plan.md`; each wrote a paragraph explaining why it skipped it. s02 PG3 and s12 repeat it.

**Fix:** `AGENTS.md`: "A ticket plan is one `## Plan` comment on its issue. If a skill asks for `tasks/plan.md`/`tasks/todo.md`, the comment replaces them — note it in one line and continue; do not ask."

### P6 · The prompt names capabilities that are not installed (3 sessions, HIGH)

s02 P2: `/goal` is not a command the orchestrator can run. s05 P5/P6: the pipeline mandates `browser-testing-with-devtools`, whose MCP is not provisioned; a stage silently substituted. s12 P3: `/plan`/`/build`/`/review` and `skill-creator` were named as installed; the next session got an empty skill.

**Fix:** a preflight step that asserts every named command, skill and MCP server resolves, and fails the run before it starts. Keep the list of names in `AGENTS.md` so it is checkable.

### P7 · Worktree, ports and `.env` are rediscovered by every stage (5 sessions, HIGH)

s02 PG1/PR10: "Stage dispatch has no session-root field, so write stages were sent to a session that could never write"; fresh worktrees are not bootstrapped. s01 P2: no rule for who may write in which worktree. s05 P7, s08 PG-4, s09 PG10 repeat it.

**Fix:** `AGENTS.md` + `scripts/preflight.sh`: create/enter the worktree, `npm ci`, copy `.env.local` from a documented template, assert the ports are free, assert the Supabase stack is the local one.

### P8 · Escalation has no threshold (3 sessions, HIGH)

s02 PG4: 53 questions across 4 plans; the owner answered "accept all" 3×; ~76 min parked. s08 PR-6: 7 guesses reported at the end, 2 reversed. s10: "`stop and report` never operationalised: the agent made 8 uncovered decisions and reported them only at the end."

**Fix:** two explicit lists. Escalate: anything that changes a schema, an ADR, an acceptance criterion, or spends money. Decide and log: everything else, in a `## Decisions` block on the issue, before the code is written.

### P9 · "Never route around a guard" arrived mid-run (2 sessions, HIGH)

s02 PG2: #79's implementer wrote 54 files via Bash heredocs around the Write hook, before the rule existed. s01 P2: 2 shell bypasses, 2 fix rounds discarded with zero commits.

**Fix:** state it before the run, and make the guard report *why* it refused, so the agent has a legal path.

## B. What is missing in the process

### G1 · Verification is single-sourced and not enforced (7 sessions, HIGH)

s03 G5: "3/3 reviews ran no tests, no CI". s02 PR11: "'Merge-ready' is asserted entirely from agent-run local commands; the PRs have no checks at all." s04 G1: "`typecheck`/`test` exist but nothing runs them". s09 G1, s05 G1/G2, s08 PR-1, s10 (typecheck chained with `;` before `git commit`, 3×), s06 G2.

This is the most expensive pattern in the corpus: the same defect class (a gate that passes without exercising the change) appears in seven sessions.

**Fix:** one `npm run verify` that runs typecheck + test + e2e, with `CI=1`, against an isolated DB and free ports; the PR body must contain its output at the reviewed SHA. No CI means the gate must be a script, not a convention.

### G2 · The test environment is shared and mutable (5 sessions, HIGH)

s08 PR-1: `reuseExistingServer: !CI` + shared ports, so "e2e can validate another worktree's code; the fix-round gate was void". s08 PR-3: "a RED test ran against the shared Supabase DB and committed its mutation: a phantom row, changing AC1's seed hash 72→73". s02 PR3: "test/e2e could have written to the hosted database; only manual port checks prevented it". s09 G2: 14 + 5 rows of pollution. s08 PR-7: 11 worktrees, one Supabase stack, one test user.

**Fix:** e2e must fail if the port is already in use (never reuse), and tests run against a per-run schema or an ephemeral stack. Add a `pg_isready`/port assertion to preflight.

### G3 · The fix loop does not converge (4 sessions, HIGH)

s01 G2: 5 fix rounds for #79, 4 for #80; rounds 3 and 4 on `auth.ts` each shipped a new defect the next review caught. s06 G1: round 4 prescribed `if (!keys || inFlight) return refresh();`, round 5 reverted it, one wasted round. s07 P2: the plan specified the pin bound by example and by formula, both defective. s09 PG2: 5 fix commits.

**Fix:** max 2 fix rounds; then file an issue and ship or block explicitly. Each review round must include the previous round's report, and a review may not prescribe code it has not checked against the implementer's reported side effects.

### G4 · There is no merge gate, and PR stacking is unbounded (4 sessions, HIGH)

s01 G3: "#99 merged with no review, and #99 + #101 merged a minute apart with the integration test run only afterwards." s03 G2: 3-deep PR stack on shared files. s04: shipped without wiring CI. s12 G1: the foundation commit bypassed plan/test/review — 0 tests, 2 critical advisories, no review.

**Fix:** merge requires (a) a review verdict on the SHA, (b) `npm run verify` output on the SHA, (c) one in-flight PR per shared file set. Stack depth > 1 needs an owner decision.

### G5 · Plan artifacts are never amended (4 sessions, HIGH)

s03 G1: "#86's plan comment still asserts 'moves only V1… exactly 1 write' and '17:15' where the code does 2 rows and 17:25". s08 PR-8: a fix round changed an owner-approved Decision without amending the Decision comment. s10: plan step order wrong (`derive.test.ts` omitted → TS2739). s02 PR2: AC1 reported passing while its approved command order could not pass.

**Fix:** any change to a Decision, an AC, or a plan number requires editing the issue comment in the same turn as the code change. Review checks plan-vs-code consistency explicitly.

### G6 · Broken hooks and plugins block work, then get routed around (3 sessions, HIGH)

s02 PR4: `merge-gate.sh` uses `grep -P`; every base merge blocked, PR #94 conflicted ~70 min until the human merged. s07 G3: the orchestrator dispatched a merge through a hook it already knew failed. s09 G3: the merge-gate hook "blocks any command containing 'merge' and errors on macOS".

**Fix:** hooks are code and need the same gate as code: a smoke test per hook before a run, and a documented disable path that does not require a human.

### G7 · Run state dies with the context (3 sessions, HIGH)

s01 PR9: "the orchestrator's run state existed only in its context; a compaction forced a full reconstruction". s03 G9: "three concurrent stages, no checkpoint, and the run dies at the rate limit". s06: 6.5 h idle with no activity (23:08 → 05:41).

**Fix:** a run journal on disk (`docs/agents/runs/<date>.md`): stage, ticket, branch, SHA, gate result, next action. Resume reads the journal, not the context.

### G8 · Success is reported without verification (2 sessions, HIGH)

s11 G1: tool output shows `timeout` + `sub_issue_id: ""` (HTTP 422) + "sub-issue link failed for #83", yet the final message asserts every ticket is linked. s05 G1: AC1 reported met on the owner's "2 done" while `/auth/v1/settings` still had sign-ups enabled.

**Fix:** a claim of completion must quote the command and its output. "Linked" means the API returned the link.

### G9 · Follow-ups are never filed (1 session, HIGH, likely systemic)

s03 G8: "a review-known deadlock ('NON-BLOCKING (should fix)') shipped in PR #107; 10+ follow-ups exist only as PR prose, no `gh issue create`". The same shape appears in s07's open question about nits N1/N3/N4.

**Fix:** review findings that are not fixed in the round must produce an issue before the review verdict is posted — one `gh issue create` per finding, linked in the verdict.

## C. What worked

- **Adversarial review catches real defects.** s01 and s02 both credit it; s01's four PRs shipped with review findings that were genuine. Do not weaken this to save tokens.
- **Narrow, one-concern commits** (s07) made the fix rounds reviewable and revertible — s06 could revert round 4 cleanly because the commit was isolated.
- **The pipeline itself works when the brief is complete**: s01 shipped 4 merged PRs in one session; s10 did 9 commits and verified all ACs in 15 minutes.
- **The friction log** is the reason this retrospective has evidence at all. It is the one artefact that should be promoted out of `/private/tmp` first.

## D. Top 5 changes, ordered by (frequency × cost) / effort

1. **Write the pipeline into `AGENTS.md`** — stage order, session root per stage, base branch `feat/mvp-scaffold`, done-definition, escalation lists, guard rules, planning-artifact rule. (~1 page; kills P1, P2, P3, P5, P8, P9.)
2. **Move `RULES.md` + friction log into the repo** (`docs/agents/rules.md`, `docs/agents/runs/`). Versioned, diffable, survives cleanup. (kills P1's restatement cost and G7.)
3. **One executable gate** — `npm run verify` (typecheck + test + e2e, `CI=1`, isolated DB, no server reuse), output required in the PR at the reviewed SHA. (kills G1, G2.)
4. **Preflight script** — assert named skills/MCP/commands resolve, ports free, `.env.local` present, Supabase stack local, hooks smoke-tested. (kills P6, G6, half of P7.)
5. **Bound the fix loop and force plan amendment** — max 2 rounds, issue-per-unfixed-finding, Decisions/ACs amended in the same turn as the code. (kills G3, G5, G9.)

## E. Open questions

These are transcript limits, not findings — each needs the owner or a repo check:

- **Who owns the base branch?** s03 and s05 both shipped to `main`; s04 says `feat/mvp-scaffold` had just landed. Was `main` ever intended?
- **Does this Claude Code setup read `AGENTS.md` at all?** s04's own retro gave both answers. An `@AGENTS.md` import in `CLAUDE.md` is the safe fix either way.
- **Did the scheduled improvement pass ever run?** s01, s02, s03 all end before it; `chore/agent-instructions-*` branches were not created.
- **How much of the token spend is the guard vs the fix loop?** s01 estimates 1.5–2M from run counts, not measurements.
- **Were the 53 escalated decisions in s02 genuinely owner decisions?** Three "accept all" replies suggest the threshold, not the questions, was wrong.

## F. Status, 24 Oct 2026

Answers to §E, from the repo:

- **Base branch:** `main`. `feat/mvp-scaffold` merged into `main` in #102, and #106–#108 all target `main`. P2's fix ("PRs target `feat/mvp-scaffold`") is superseded; `docs/agents/workflow.md` says `main`, with stacking rules.
- **AGENTS.md:** Claude Code loads `CLAUDE.md`, not `AGENTS.md`. `CLAUDE.md` now imports it with `@AGENTS.md`.
- **Improvement pass:** it ran. `chore/agent-instructions-2026-10-23` is PR #110.
- Token split and the 53 decisions stay open; the "Decide or escalate" rule now sets the threshold.

Where each finding is addressed (`workflow.md` section in brackets):

| Finding | Status |
|---|---|
| P1 stage contract | Done [Stages], #110 + this follow-up |
| P2 base branch | Done [Branches], #110 |
| P3 done-definition | Done [Tests: Evidence is pinned to a SHA] |
| P4 test ceiling | Done [Tests: Test floor] |
| P5 skill vs repo | Done [Stages: The brief wins], [Plans] |
| P6 preflight for named skills/MCP | Open: only the chrome-devtools note |
| P7 worktree, ports, `.env` | Done as steps [A new worktree], #110. No preflight script |
| P8 escalation threshold | Done [Stages: Decide or escalate] |
| P9 guard bypass | Done [Stages: A guard refusal is a stop] |
| G1 single-sourced verification | Rule done [Tests]. No `npm run verify` or CI (#105) |
| G2 shared test env | Port check done, #110. No DB isolation |
| G3 fix loop | Done [Code and review: Two fix rounds] |
| G4 merge gate, stacking | Stacking done, #110. The owner merges. No enforced gate |
| G5 plan amendment | Done [Plans: Amend in the same turn] |
| G6 broken hooks | Open |
| G7 run state | Partial: friction lists go on the issue. No run journal |
| G8 unverified success | Done for tests [Tests]. Not generalised |
| G9 follow-ups | Done [Code and review: Unfixed findings become issues] |

Subagent models are now set in `CLAUDE.md`: Haiku for narrow tasks, Sonnet for judgement.

## Appendix: why the corpus was cheap to review

The raw history is 120 MB across 107 files, but 34 files are byte-identical duplicates and 43% of lines in the largest transcript repeat a `message.id`. A 130-line extractor (`.claude/tmp/retro/extract.cjs`) turned 15 root sessions (37.8 MB) into 1.4 MB of reviewable text — human turns and assistant text verbatim, tool calls as one-line skeletons, tool output only where it looked like a failure, secrets redacted. Each of the 12 reviews then fit in one agent context (11 KB–415 KB), so the constraint was never context; it was choosing which sessions to read.
