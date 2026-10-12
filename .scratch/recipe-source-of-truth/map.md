# Map: Source of truth for Recipes — database or Cooklang files?

Label: wayfinder:map

## Destination

An ADR naming the canonical store for **Recipes** (incl. sub-recipes), plus a sync spec — what happens on edit, on conflict, on import — concrete enough to plan the build. MiseFlow is local-first, single kitchen; Recipes are edited both in the app and as files.

## Notes

- Domain: cooking/menu planning. Vocabulary in `/CONTEXT.md` — use its terms (Recipe, Step, Ingredient, Dish, Service, Make-ahead window, Station).
- Skills each session should consult: `grilling` + `domain-modeling` for grilling tickets; `research` for research tickets.
- Top driver for Cooklang is **portability / exit**: a kitchen must be able to leave MiseFlow with its recipes intact. Judge options against that first.
- Database: SQLite assumed, Supabase still possible.
- File layout (settled while charting): one `.cook` file per Recipe in a user-chosen library folder; user owns the folder structure; sub-recipes are their own files referenced by relative path.
- Tracker: local markdown (`.scratch/`), per `docs/agents/issue-tracker.md`. Claim a ticket by setting its `Assignee:` line before any work. Repo is not a git repo, so research findings live in `research/` here, not on branches.

## Decisions so far

<!-- one line per closed ticket: [title](issues/NN-slug.md): gist -->

- [Does a Supabase backend change whether files can be canonical?](issues/02-backend-vs-files.md): only local SQLite keeps files-canonical open; Supabase (hosted or synced) makes the server canonical. Needs a desktop shell; detect edits by rescan + hash.
- [What can a Cooklang file carry, and can it round-trip losslessly?](issues/01-cooklang-capabilities.md): good as a portable format, not a complete store. Per-Step make-ahead windows and Ingredient tags or Station have nowhere to go, ids need custom front matter, and writing a file back loses formatting unless edits patch the text in place.

## Not yet specified

- **Broken references**: a sub-recipe file deleted or moved outside the app while Dishes depend on it.
- **Importing an existing collection**: first-run import of a folder of `.cook` files (or other formats) into MiseFlow.
- **Assembling the sync spec**: the final write-up stitching the answers into one spec + ADR.

## Out of scope

- Storage of Menus, Courses, Dishes, Services, Plans, Tasks, Availability, Equipment — database-only regardless; Cooklang can't express them.
- Choosing the overall stack (SQLite vs Supabase) beyond how it affects this question.
- Implementing or migrating storage — this map ends at the ADR + spec.
- [Does a planned Dish follow later Recipe edits?](issues/06-dish-follows-recipe.md): closed as out of scope. It's about how Dishes, Tasks and the Shopping list behave, not about storing Recipes. The Shopping list part moves to the units map.
