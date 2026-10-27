# Using the mattpocock skills

The mattpocock skills run the work here. This repo adds only `CODING_STANDARDS.md` (setup, tests, code rules) and the notes below. Most flow skills are typed by you: an agent can't start them by itself.

## The flow

1. **Not sure what to build yet:** `/wayfinder`. It keeps a map issue of decision tickets (research, prototype, grilling or task). Each run claims one ticket from the frontier (open, unblocked, unclaimed) and resolves it, calling `/research`, `/prototype`, or `/grilling` with `/domain-modeling`. It doesn't build anything.
2. **`/to-spec`**, in the session that holds the context. It turns the map's decisions or the conversation into a spec issue labelled `ready-for-agent`. It checks the testing seams with you: that's where your questions get answered.
3. **`/to-tickets <spec #>`** splits the spec into tracer-bullet tickets, as sub-issues of the spec with native blocking links. It checks the breakdown with you before publishing.
4. **`/implement-spec <spec #>`** builds the whole spec on one integration branch, with one PR per spec. Implementer subagents each take a frontier ticket in their own worktree with `tdd`, a merger subagent merges them in, and `code-review` runs on the result. For a single small ticket, use `/implement <ticket #>`, which commits to the current branch.

Clear the context between specs. Other entry points: `/triage` for incoming issues, `/diagnosing-bugs`, `/improve-codebase-architecture` and `/retro`.

## Notes for this repo

- Tickets from `/to-tickets` are fully specified. Build them without stopping for a per-ticket Plan.
- Give every implementer `CODING_STANDARDS.md`. `code-review` checks the diff against it.
- Name the integration branch `spec/<n>-<slug>`. In a cloud session, push only to the session's `claude/...` branch and use it as the integration branch.
- Each push cancels the running CI (about 5 minutes), so batch fixes into one push.
- For an unattended run, type `/goal The PR for spec #<n> is ready for review and its URL is in the last message, or the last message says why the run can't go on.`
