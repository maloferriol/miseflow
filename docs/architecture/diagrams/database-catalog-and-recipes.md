# Database: catalog and recipes

The Ingredient catalog and Recipe tables from `shared/src/schema.ts` (Drizzle, Postgres). The
other half of the schema (Menus, Services, Batches, Cooks, the Plan) is in
[database-menus-and-planning.md](database-menus-and-planning.md).

```mermaid
erDiagram
    kitchen_settings {
        uuid id PK
        uuid owner_id "Supabase user id, not an FK"
        text mass_unit "not null, default g"
        text volume_unit "not null, default ml"
        text count_unit "not null, default each"
        text unit_region "not null, default metric"
        time default_service_time "nullable"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    shopping_categories {
        uuid id PK
        uuid owner_id "null on seed rows"
        text name "not null"
        text position "fractional index"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    ingredients {
        uuid id PK
        uuid owner_id "null on seed rows"
        text name "not null"
        text fdc_id "nullable"
        text source "seed or own"
        text preferred_kind "nullable"
        text main_unit "nullable"
        uuid shopping_category_id FK "nullable"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    ingredient_aliases {
        uuid id PK
        uuid owner_id "null on seed rows"
        uuid ingredient_id FK "not null"
        text name "not null, indexed"
        text source "seed or own"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    ingredient_overrides {
        uuid id PK
        uuid owner_id UK "unique with ingredient_id"
        uuid ingredient_id FK, UK "not null"
        text main_unit "nullable"
        uuid shopping_category_id FK "nullable"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    conversions {
        uuid id PK
        uuid owner_id "null on seed rows"
        uuid ingredient_id FK "not null"
        text from_unit "not null"
        text to_unit "not null"
        numeric factor "not null"
        text source "seed or own"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    recipes {
        uuid id PK
        uuid owner_id "Supabase user id, not an FK"
        text name "not null"
        numeric servings "nullable"
        text yield_text "unused since #84"
        numeric yield_quantity "nullable"
        text yield_unit "nullable, null means pieces"
        integer make_ahead_before_days "nullable"
        integer shelf_life_days "nullable"
        text source "nullable, free text"
        integer latest_revision "not null, default 1"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    recipe_revisions {
        uuid id PK
        uuid owner_id "Supabase user id, not an FK"
        uuid recipe_id FK, UK "not null, unique with number"
        integer number UK "not null"
        jsonb snapshot "whole Recipe, not null"
        timestamptz created_at "append-only"
    }

    steps {
        uuid id PK
        uuid owner_id "Supabase user id, not an FK"
        uuid recipe_id FK "not null, indexed"
        text position "fractional index"
        jsonb body "token array, default empty"
        integer active_minutes "nullable"
        integer passive_minutes "nullable"
        integer make_ahead_before_days "nullable"
        integer shelf_life_days "nullable"
        boolean group_with_previous "not null, default false"
        uuid station_id "later phase, no FK"
        boolean mise_en_place "later phase, nullable"
        boolean serve_straight_away "not null, default false"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    ingredient_lines {
        uuid id PK
        uuid owner_id "Supabase user id, not an FK"
        uuid step_id FK "not null"
        uuid ingredient_id FK "nullable, check: not both"
        uuid sub_recipe_id FK "nullable, check: not both"
        numeric quantity "nullable"
        numeric quantity_max "upper end of a range"
        text unit "nullable"
        text wording "nullable"
        text preparation "nullable"
        boolean fixed_quantity "not null, default false"
        text position "fractional index"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    step_dependencies {
        uuid id PK
        uuid owner_id "Supabase user id, not an FK"
        uuid recipe_id FK "not null"
        uuid before_step_id FK, UK "not null, unique with after_step_id"
        uuid after_step_id FK, UK "not null"
        timestamptz updated_at
        timestamptz deleted_at "soft delete"
    }

    shopping_categories |o--o{ ingredients : "shopping_category_id"
    shopping_categories |o--o{ ingredient_overrides : "shopping_category_id"
    ingredients ||--o{ ingredient_aliases : "ingredient_id"
    ingredients ||--o{ ingredient_overrides : "ingredient_id (one per owner)"
    ingredients ||--o{ conversions : "ingredient_id"
    ingredients |o--o{ ingredient_lines : "ingredient_id"
    recipes ||--o{ recipe_revisions : "recipe_id"
    recipes ||--o{ steps : "recipe_id"
    recipes |o--o{ ingredient_lines : "sub_recipe_id"
    recipes ||--o{ step_dependencies : "recipe_id"
    steps ||--o{ ingredient_lines : "step_id"
    steps ||--o{ step_dependencies : "before_step_id"
    steps ||--o{ step_dependencies : "after_step_id"
```

## How to read it

- **Ids and owners.** Every `id` is a browser-made uuid and the only primary key. `owner_id` is the
  Supabase Auth user id. It is not a foreign key: there is no users table in this schema, and reads
  and writes scope by it in code (for example `eq(recipes.ownerId, ownerId)` in
  `shared/src/mutators/revision.ts`). `kitchen_settings` has no foreign keys at all; it holds the
  kitchen's Main unit per kind of measure and the default Service time.
- **Soft deletes.** Every table here except `recipe_revisions` has `deleted_at`; a row is removed by
  setting it, and reads filter on `deleted_at is null`. Foreign keys are all `ON DELETE no action`,
  so a soft-deleted parent still satisfies them. ADR 0010 notes that an Ingredient line pointing at
  a soft-deleted sub-recipe reads as a Missing sub-recipe.
- **Seed rows and kitchen rows share tables.** `shopping_categories`, `ingredients`,
  `ingredient_aliases` and `conversions` hold both. Seed rows have `owner_id` null (and
  `source = 'seed'` where the table has a `source` column); they are loaded by `server/src/seed.ts`
  and never edited. A kitchen sees seed rows plus its own live rows (`visibleTo` in
  `shared/src/catalog/visibility.ts`). A kitchen's change to a seed Ingredient (its Main unit or
  Shopping category) goes in `ingredient_overrides`, unique on (`owner_id`, `ingredient_id`), so
  the ODbL seed stays untouched.
- **Ingredient lines point at one target.** A line belongs to a Step and links either to an
  Ingredient (`ingredient_id`) or to another Recipe used as a sub-recipe (`sub_recipe_id`). The
  check `ingredient_lines_one_target` forbids both; neither set means a Missing sub-recipe.
- **Revisions.** The working copy is the normalized rows (`recipes`, `steps`, `ingredient_lines`,
  `step_dependencies`). Every edit mutation bumps `recipes.latest_revision` and appends one
  `recipe_revisions` row holding a jsonb snapshot of the whole Recipe, in the same transaction
  (`appendRevision` in `shared/src/mutators/revision.ts`). The table is append-only, so it has
  `created_at` but no `updated_at` or `deleted_at`, and (`recipe_id`, `number`) is unique.
- **Step dependencies** are manual finish-to-start links: `before_step_id` must finish before
  `after_step_id` starts. Each pair is unique.
- **Referenced from the other half of the schema.** `dishes.recipe_id` and `batches.sub_recipe_id`
  point at `recipes`; `task_placements.first_step_id` and `step_events.step_id` point at `steps`;
  `shopping_marks.ingredient_id` points at `ingredients`. Those tables are drawn in
  [database-menus-and-planning.md](database-menus-and-planning.md).

## Source files

- [shared/src/schema.ts](../../../shared/src/schema.ts): the Drizzle table definitions
- [shared/migrations/0000_soft_ezekiel_stane.sql](../../../shared/migrations/0000_soft_ezekiel_stane.sql): the generated tables, foreign keys and checks
- [shared/migrations/0002_sleepy_praxagora.sql](../../../shared/migrations/0002_sleepy_praxagora.sql): the `ingredient_overrides` unique constraint
- [shared/migrations/0003_oval_white_tiger.sql](../../../shared/migrations/0003_oval_white_tiger.sql): `ingredient_lines.quantity_max`
- [shared/migrations/0004_sharp_maelstrom.sql](../../../shared/migrations/0004_sharp_maelstrom.sql): `recipes.yield_quantity` and `yield_unit`
- [shared/src/catalog/visibility.ts](../../../shared/src/catalog/visibility.ts): which seed and own catalog rows a kitchen sees
- [shared/src/mutators/revision.ts](../../../shared/src/mutators/revision.ts): Recipe locking and Revision snapshots
- [server/src/seed.ts](../../../server/src/seed.ts): loads the ownerless seed rows
- [docs/adr/0010-mvp-schema.md](../../adr/0010-mvp-schema.md): the MVP schema decisions
- [docs/adr/0002-ingredient-lines-link-to-ingredients.md](../../adr/0002-ingredient-lines-link-to-ingredients.md): why lines link to an Ingredient
