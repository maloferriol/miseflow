# Database: menus, services and planning

The Menu, Service, Cook and Plan tables in `shared/src/schema.ts`, with their columns and foreign
keys. `recipes`, `steps` and `ingredients` appear only as stubs (their `id`) because rows here
point at them; their full columns are in [Database: catalog and recipes](database-catalog-and-recipes.md).

```mermaid
erDiagram
    menus {
        uuid id PK
        uuid owner_id "not an FK"
        text name
        integer guest_count "nullable"
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    courses {
        uuid id PK
        uuid owner_id "not an FK"
        uuid menu_id FK
        text name
        text position "fractional index"
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    services {
        uuid id PK
        uuid owner_id "not an FK"
        uuid menu_id FK,UK "one Service per Menu"
        date date
        time time "nullable"
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    dishes {
        uuid id PK
        uuid owner_id "not an FK"
        uuid course_id FK
        uuid recipe_id FK
        text position "fractional index"
        numeric scale_factor "nullable"
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    batches {
        uuid id PK
        uuid owner_id "not an FK"
        uuid service_id FK "unique with sub_recipe_id"
        uuid sub_recipe_id FK "references recipes"
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    cooks {
        uuid id PK
        uuid owner_id "not an FK"
        text name
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    availability_weekly {
        uuid id PK
        uuid owner_id "not an FK"
        uuid cook_id FK
        integer weekday "0 Sunday to 6 Saturday"
        time start_time
        time end_time
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    availability_overrides {
        uuid id PK
        uuid owner_id "not an FK"
        uuid cook_id FK
        date date
        time start_time "nullable, null means unavailable"
        time end_time "nullable"
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    task_placements {
        uuid id PK
        uuid owner_id "not an FK"
        uuid service_id FK
        uuid dish_id FK "nullable, exactly one of dish or batch"
        uuid batch_id FK "nullable"
        uuid first_step_id FK "references steps"
        integer start_minute
        uuid cook_id FK "nullable"
        boolean pinned "default false"
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    step_events {
        uuid id PK
        uuid owner_id "not an FK"
        uuid service_id FK
        uuid dish_id FK "nullable, exactly one of dish or batch"
        uuid batch_id FK "nullable"
        uuid step_id FK
        text kind "done or undone"
        timestamptz at
    }
    shopping_marks {
        uuid id PK
        uuid owner_id "not an FK"
        uuid service_id FK "unique with ingredient_id"
        uuid ingredient_id FK
        text status "got, ordered or already_have"
        numeric amount "nullable"
        timestamptz updated_at
        timestamptz deleted_at "nullable, soft delete"
    }
    applied_mutations {
        uuid id PK "the mutation's id"
        uuid owner_id "not null, not an FK"
        text name
        timestamptz applied_at
    }
    recipes {
        uuid id PK
    }
    steps {
        uuid id PK
    }
    ingredients {
        uuid id PK
    }

    menus ||--o{ courses : "menu_id"
    menus ||--o| services : "menu_id (unique)"
    courses ||--o{ dishes : "course_id"
    recipes ||--o{ dishes : "recipe_id"
    services ||--o{ batches : "service_id"
    recipes ||--o{ batches : "sub_recipe_id"
    cooks ||--o{ availability_weekly : "cook_id"
    cooks ||--o{ availability_overrides : "cook_id"
    services ||--o{ task_placements : "service_id"
    dishes |o--o{ task_placements : "dish_id"
    batches |o--o{ task_placements : "batch_id"
    steps ||--o{ task_placements : "first_step_id"
    cooks |o--o{ task_placements : "cook_id"
    services ||--o{ step_events : "service_id"
    dishes |o--o{ step_events : "dish_id"
    batches |o--o{ step_events : "batch_id"
    steps ||--o{ step_events : "step_id"
    services ||--o{ shopping_marks : "service_id"
    ingredients ||--o{ shopping_marks : "ingredient_id"
```

Columns are not null unless marked nullable. Every `id` is a browser-made uuid. `owner_id` is a
plain uuid column with no foreign key in the schema or the migrations; it is nullable everywhere
except `applied_mutations`. No foreign key has an `ON DELETE` action (all are `no action`), and
rows are soft-deleted through `deleted_at` instead.

## What each group stores

- **Menus and Dishes.** A Menu (`menus`) has ordered Courses (`courses`), and each Course has
  ordered Dishes (`dishes`), each pointing at the Recipe it serves, with an optional Scale factor.
- **Services and Batches.** A Service (`services`) is the dated event for a Menu. In the MVP
  `services.menu_id` is unique, so a Menu has at most one Service. `batches` holds one row per
  sub-recipe per Service (unique on `service_id, sub_recipe_id`), so pins and progress have a
  Batch id to hang off.
- **Cooks and availability.** `cooks` lists the Cooks. `availability_weekly` gives a Cook's
  hours per weekday; `availability_overrides` replaces them on one date, where a null start and
  end means the Cook is unavailable.
- **The Plan.** `task_placements` stores one row per placed Task: the Task is keyed by its
  Service, its Dish or Batch (a check requires exactly one) and its first Step, with a
  `NULLS NOT DISTINCT` unique constraint on those four columns. Each row holds the start minute,
  the optional Cook and the `pinned` flag for Tasks the user pinned.
- **Progress.** `step_events` is append-only (no `updated_at` or `deleted_at`): each row records a
  Step of a Dish or Batch being marked `done` or `undone` at a time, and a Step's state is its
  latest event. It is indexed on `service_id`.
- **Shopping status.** `shopping_marks` holds one mark per Service and Ingredient (unique on
  `service_id, ingredient_id`), with a status of `got`, `ordered` or `already_have` (the MVP writes
  only `got`) and an optional amount.
- **Idempotency.** `applied_mutations` is append-only with one row per applied named mutation,
  whose `id` is the mutation's id, so a retried mutation is applied once (ADR 0007). It has no
  foreign keys.

## Source files

- [shared/src/schema.ts](../../../shared/src/schema.ts): the Drizzle table definitions
- [shared/migrations/](../../../shared/migrations/): the generated SQL, including the foreign keys
  and constraints
- [docs/adr/0010-mvp-schema.md](../../adr/0010-mvp-schema.md): why the schema has this shape
- [docs/adr/0007-writes-are-named-mutations-to-one-endpoint.md](../../adr/0007-writes-are-named-mutations-to-one-endpoint.md):
  named mutations and the idempotency they rely on
