# MiseFlow

@AGENTS.md

## Picking a subagent's model

Every Agent call sets `model`: `"opus"`, `"sonnet"` or `"haiku"`. A subagent with no `model` inherits the orchestrator's, which may not fit its task. The orchestrator itself keeps synthesis and owner decisions.

### Opus: planning and review

Run these on Opus (`model: "opus"`). A defect missed here costs every later stage:

* Planning a ticket (the Plan agent)
* Reviewing a PR or a diff for defects, including each fix round's review

### Haiku: narrow tasks

Run these on Haiku (`model: "haiku"`). Use the `Explore` agent type for searches.

Narrow tasks have a clear spec and a checkable result:

* Codebase search and "where is X handled" lookups (`Explore`)
* Running tests or a build and summarizing failures
* Mechanical edits: renames, updating imports, adding a field across files
* Checking a diff against a short list of rules
* Formatting or converting data
* Reading or writing to GitHub (issues, PRs, comments) via `gh`

Tell the subagent exactly what to run or change and what a passing result looks like, and ask it to return a short summary, not raw output. Copy the exact commands from `docs/agents/workflow.md` into the brief, `-w <workspace>` and "report both workspaces' totals" included: the Haiku test agents in #86 and #87 read only their brief and broke both rules.

### Sonnet: judgement tasks

Run these on Sonnet (`model: "sonnet"`). They need judgement, or the spec has gaps the agent must fill:

* Implementing a ticket, and its fix rounds
* Diagnosing a failure whose cause is unknown
* Reviewing one transcript in a retrospective
* Writing or rewording docs and agent instructions

When a Haiku task comes back confused, or breaks a rule its brief gave it, rerun it on Sonnet rather than retrying on Haiku.
