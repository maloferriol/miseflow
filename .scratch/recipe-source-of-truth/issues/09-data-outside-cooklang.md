# Where does Recipe data that Cooklang can't hold live?

Type: grilling
Status: open
Blocked by: —
Assignee: —

## Question

Per-Step make-ahead windows and shelf life, and Ingredient allergen/dietary tags and default Station, have no place in Cooklang syntax. A Recipe-level make-ahead window and a stable id fit only as custom front-matter keys that other tools ignore. Choose a home for each:
- custom front matter (Recipe-level only)
- a sidecar file next to the recipes, such as an ingredient catalog in the style of `aisle.conf`, or a per-recipe sidecar for Step data
- database-only

Judge each against portability: what does a kitchen that leaves MiseFlow keep?

This answer feeds the canonical-store decision (03), not the other way round: it decides whether option (c), split, is workable.

The units map (`.scratch/units/`) also needs per-Ingredient unit facts to live in whatever home this picks: density (weight per volume), weight per piece, and pack sizes. That map designs the unit model without deciding where these are stored, and leaves that to this ticket.
