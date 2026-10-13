# MVP schema: a working copy with snapshots, a stored Plan, everything else derived

The MVP stores the latest state of every Recipe as **normalized rows** (`recipes`, `steps`, `ingredient_lines`, `step_dependencies`). Mutators edit those rows, and everything reads them. Every edit mutation also appends an immutable **jsonb snapshot** of the whole Recipe to `recipe_revisions`, in the same transaction. The **Plan is stored** as one placement row per placed Task, because re-plan must move only what must move, and that needs the previous Plan as input. Everything else is **derived on read**: Tasks, scaled Quantities, Batch sizes, the Shopping list, Unplaced Tasks and conflicts. Decided on [#64](https://github.com/maloferriol/miseflow/issues/64).

## Decisions a reader would question

- **No `tasks` table.** A Task is keyed by its Dish or Batch plus its first Step's id. Grouping is a Recipe-level "group with previous Step" flag. A split Step keeps its id ([import/export spec §2](../recipe-import-export-spec.md#2-identity)), so the key survives edits. A regrouped Task whose first Step changes loses its placement and is planned again. Phase 3's Mise en place task will be keyed by (Service, prep day).
- **Placements are written by the re-plan mutator.** The pure scheduler runs in the browser for the optimistic update and on the server for the authoritative one, and the mutator writes the difference ([ADR 0007](0007-writes-are-named-mutations-to-one-endpoint.md)).
- **Batches are stored rows**, though the MVP could derive them (one per sub-recipe per Service). Pins and progress hang off a Batch's id, and phase 5's split and merge need rows. Their Scale factor is derived.
- **One Service per Menu** in the MVP: `services.menu_id` is unique. Rows that belong to a Service (Batches, placements, progress events, Shopping marks) still carry `service_id`, so allowing several Services per Menu later only drops that constraint and moves the Dish's Scale factor.
- **Seed and own Ingredients share one table.** Seed rows have no owner and `source = 'seed'`. They're loaded by a seed script and never edited. Your changes to a seed Ingredient go in `ingredient_overrides`. Ingredient lines link to one table ([ADR 0002](0002-ingredient-lines-link-to-ingredients.md)), and the ODbL seed stays separate from your data ([ADR 0003](0003-ingredient-seed-published-under-odbl.md)).
- **Step text is a jsonb token array** (text, or a reference to one of the Step's Ingredient lines), which maps one to one onto Cooklang.

## Conventions

Every table has a browser-made `id uuid` as its only primary key, `owner_id` (null only on seed rows), `updated_at` and a soft-delete `deleted_at`. The append-only tables (`recipe_revisions`, `step_events`) have no `updated_at` or `deleted_at`. Where a row belongs to either a Dish or a Batch, it has nullable `dish_id` and `batch_id` with a check that exactly one is set, so both are real foreign keys. Ordered rows use a fractional-index `position`. Fields for later phases (a Step's Station, the Mise en place and Serve straight away flags) are nullable columns from the start.

## Tables

| Table | Holds |
| --- | --- |
| `kitchen_settings` | One row: the Main unit for each kind of measure, the Unit region (fixed for now), the default Service time |
| `shopping_categories` | The seeded categories in their fixed order |
| `ingredients` | Seed and own Ingredients: name, FDC id, preferred kind of measure, Main unit, Shopping category |
| `ingredient_aliases` | Other names for an Ingredient, seed or own |
| `ingredient_overrides` | Your Main unit or Shopping category for a seed Ingredient |
| `conversions` | Ingredient, from unit, to unit, factor, seed or own |
| `recipes` | Name, servings, yield, make-ahead window, source, latest Revision number |
| `recipe_revisions` | Recipe, number, full jsonb snapshot. Append-only |
| `steps` | Recipe, position, body tokens, active and passive time, make-ahead override, group with previous, later-phase fields |
| `ingredient_lines` | Step, either `ingredient_id` or `sub_recipe_id` (neither: a Missing sub-recipe, as is a soft-deleted sub-recipe), Quantity, wording, preparation, Fixed quantity flag |
| `step_dependencies` | Manual finish-to-start links between Steps of one Recipe |
| `menus` | Name, guest count |
| `courses` | Menu, position, name |
| `services` | Menu (unique), date, optional time |
| `dishes` | Course, Recipe, position, Scale factor override |
| `batches` | Service, sub-recipe |
| `cooks` | One auto-created row; the roster adds rows in phase 3 |
| `availability_weekly` | Cook, weekday, start, end |
| `availability_overrides` | Cook, date, hours or none |
| `task_placements` | Service, Dish or Batch, first Step, start, Cook, pinned. Unique per Task |
| `step_events` | Service, Dish or Batch, Step, kind (`done`, `undone`; phase 4 adds more), time. Append-only; a Step's state is its latest event |
| `shopping_marks` | Service, Ingredient, status (the MVP writes only `got`), amount (used from phase 2) |

## Considered Options

- **Versioned Step rows** keyed by (Step, Revision). Every MVP read becomes "latest per id".
- **Revisions as documents only.** No foreign keys from pins and progress to Steps, and no "which Recipes use this Ingredient".
- **Deriving the whole Plan on read**, storing only pins. Stability would depend on the greedy scheduler happening to give the same answer, and the Today checklist and printouts need a fixed Plan.
- **Materialized Task rows**, reconciled whenever a Recipe, Dish or grouping changes.
- **Copying the seed into each user's rows**, or separate `seed_*` tables without an owner.
