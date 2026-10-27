# MiseFlow

@AGENTS.md

## Delegating narrow tasks to Haiku subagents

Run these through a subagent on the Haiku model (`model: "haiku"` on the Agent tool). Use the `Explore` agent type for searches.

Narrow tasks have a clear spec and a checkable result:

* Codebase search and "where is X handled" lookups (`Explore`)
* Running tests or a build and summarizing failures
* Mechanical edits: renames, updating imports, adding a field across files
* Checking a diff against a short list of rules
* Formatting or converting data
* Reading or writing to GitHub (issues, PRs, comments) via `gh`

Tell the subagent exactly what to run or change and what a passing result looks like, and ask it to return a short summary, not raw output. Ticket stages follow the Model column in `docs/agents/orchestrator.md`.
