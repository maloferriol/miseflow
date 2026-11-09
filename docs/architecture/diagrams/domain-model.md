# Domain model

The glossary in `CONTEXT.md` drawn as classes, with each one marked by how the code holds it today:

- `<<table>>`: stored as a table in `shared/src/schema.ts` (attribute names are the Drizzle field names).
- `<<computed>>`: derived in code on every read, never stored (attribute names are the TypeScript field names).
- `<<not built>>`: in the glossary only. Nothing in `shared/`, `server/` or `web/` models it yet.

```mermaid
classDiagram
    direction LR

    %% Recipes and the Ingredient catalog
    class Recipe {
        <<table>>
        name
        servings
        yieldQuantity
        yieldUnit
        makeAheadBeforeDays
        shelfLifeDays
        latestRevision
    }
    class Revision {
        <<table>>
        recipeId
        number
        snapshot
    }
    class Step {
        <<table>>
        position
        activeMinutes
        passiveMinutes
        makeAheadBeforeDays
        groupWithPrevious
        stationId
        serveStraightAway
    }
    class IngredientLine {
        <<table>>
        stepId
        ingredientId
        subRecipeId
        quantity
        unit
        wording
        preparation
        fixedQuantity
    }
    class Ingredient {
        <<table>>
        name
        source
        preferredKind
        mainUnit
        shoppingCategoryId
    }
    class IngredientAlias {
        <<table>>
        ingredientId
        name
        source
    }
    class IngredientOverride {
        <<table>>
        ingredientId
        mainUnit
        shoppingCategoryId
    }
    class Conversion {
        <<table>>
        ingredientId
        fromUnit
        toUnit
        factor
        source
    }
    class ShoppingCategory {
        <<table>>
        name
        position
    }

    %% Menus and Services
    class Menu {
        <<table>>
        name
        guestCount
    }
    class Course {
        <<table>>
        menuId
        name
        position
    }
    class Service {
        <<table>>
        menuId
        date
        time
    }
    class Dish {
        <<table>>
        courseId
        recipeId
        position
        scaleFactor
    }
    class Batch {
        <<table>>
        serviceId
        subRecipeId
    }

    %% Planning
    class Task {
        <<computed>>
        owner
        stepIds
        activeMinutes
        passiveMinutes
        approximate
    }
    class TaskPlacement {
        <<table>>
        serviceId
        dishId
        batchId
        firstStepId
        startMinute
        cookId
        pinned
    }
    class Plan {
        <<computed>>
        placements
        unplaced
        conflicts
    }
    class Cook {
        <<table>>
        name
    }
    class Availability {
        <<table>>
        cookId
        weekday
        startTime
        endTime
    }
    class Station {
        <<not built>>
    }
    class Equipment {
        <<not built>>
    }

    %% Shopping
    class ShoppingList {
        <<computed>>
        categories
        missing
    }
    class ShoppingRow {
        <<computed>>
        ingredientId
        need
        unit
        approximate
        got
    }
    class ShoppingMark {
        <<table>>
        serviceId
        ingredientId
        status
        amount
    }
    class CombinedList {
        <<not built>>
    }

    %% Recipe structure
    Recipe "1" *-- "*" Revision : saved as
    Recipe "1" *-- "*" Step : has
    Step "1" *-- "*" IngredientLine : uses
    IngredientLine "*" --> "0..1" Ingredient : ingredientId
    IngredientLine "*" --> "0..1" Recipe : subRecipeId
    Step "*" --> "0..1" Station : stationId

    %% Catalog
    Ingredient "1" *-- "*" IngredientAlias : known as
    Ingredient "1" *-- "0..1" IngredientOverride : per kitchen
    Ingredient "1" *-- "*" Conversion : converts by
    Ingredient "*" --> "0..1" ShoppingCategory : bought in
    IngredientOverride "*" --> "0..1" ShoppingCategory : overrides

    %% Menus and Services
    Menu "1" *-- "*" Course : ordered
    Menu "1" -- "1" Service : served at
    Course "1" *-- "*" Dish : holds
    Dish "*" --> "1" Recipe : recipeId
    Service "1" *-- "*" Batch : makes
    Batch "*" --> "1" Recipe : subRecipeId
    Batch ..> Dish : feeds
    Batch ..> Batch : feeds parent

    %% Planning
    Dish "1" -- "*" Task : owner
    Batch "1" -- "*" Task : owner
    Task "*" --> "1..*" Step : groups
    Task "1" -- "0..1" TaskPlacement : placed as
    TaskPlacement "*" --> "0..1" Cook : cookId
    Service "1" -- "1" Plan : schedules
    Plan "1" o-- "*" Task : places
    Cook "1" *-- "*" Availability : free hours
    Task "*" --> "1" Station : belongs to
    Task "*" --> "*" Equipment : holds

    %% Shopping
    Service "1" -- "1" ShoppingList : needs
    ShoppingList "1" *-- "*" ShoppingRow : rows
    ShoppingRow "*" --> "1" Ingredient : ingredientId
    Service "1" *-- "*" ShoppingMark : marks
    ShoppingMark "*" --> "1" Ingredient : ingredientId
    ShoppingRow "1" -- "0..1" ShoppingMark : status
    CombinedList "0..1" o-- "*" ShoppingList : combines
```

## Reading the diagram

- **Recipe, Revision, Step, Ingredient line.** Every edit writes a whole-Recipe `snapshot` to `recipe_revisions` (append-only, numbered per Recipe). Ingredient lines hang off a Step (`step_id`), not the Recipe directly. A line points at an Ingredient *or* a sub-recipe (`sub_recipe_id`, another Recipe), never both; neither set is a **Missing sub-recipe**.
- **Ingredient catalog.** Seed and own rows share the `ingredients`, `ingredient_aliases` and `conversions` tables, told apart by `source`. A kitchen's changes to a seed Ingredient go in `ingredient_overrides`, one row per kitchen and Ingredient. The schema allows a null `shopping_category_id`, although the glossary says every Ingredient has one.
- **Menu, Service.** The glossary allows several Services per Menu; the MVP's `services.menu_id` is unique, so it's 1 to 1 for now.
- **Batch.** Stored as one row per Service and sub-recipe (`batches_service_sub_recipe`), so splitting and merging Batches aren't built yet. Its Scale factor and the Dishes or parent Batches it feeds aren't stored: `deriveBatches` (`SizedBatch.parents`) works them out on each read, hence the dashed `feeds` links.
- **Task, Pin, Plan.** A Task is computed from a Dish's or Batch's Step groups (`TaskSpec`, `TaskInfo`, `taskShape`). Only its placement is stored in `task_placements`, keyed by Service, owner and first Step, with `pinned` holding the **Pin** and `cook_id` the Cook. The **Plan** (placements, Unplaced Tasks, conflicts) is the scheduler's output and isn't stored. Step progress is stored as `step_events` (done or undone), not drawn here.
- **Cook, Availability.** Availability is two tables: weekly hours (`availability_weekly`, drawn) and per-date exceptions (`availability_overrides`, where null hours mean unavailable). The planning model takes exactly one Cook in the MVP.
- **Shopping.** The Shopping list and its rows are computed on read (`ShoppingList`, `ShoppingRow`). Only the **Shopping status** is stored, in `shopping_marks`, one per Service and Ingredient: `status` is `got`, `ordered` or `already_have` (the MVP writes only `got`), and the absence of a mark means To buy.

**Left out or not built:**

- *Not built, drawn:* **Station** (only an unlinked `steps.station_id` column, no table), **Equipment**, **Combined list**.
- *Not built, left out:* Dish override, Bought batch, Mise en place task and line (only a `steps.mise_en_place` flag), Pack size, Trim loss, Staple, Fire and Course states.
- *Left out to keep the diagram readable:* Step dependencies (`step_dependencies`), Step events, Availability overrides, Kitchen settings (units and Unit region), Quantity and unit terms, Recipe file and Import preview, and the views (Board, Prep view, Today checklist, Station prep list).

## Source files

- [CONTEXT.md](../../../CONTEXT.md)
- [shared/src/schema.ts](../../../shared/src/schema.ts)
- [shared/src/recipe/snapshot.ts](../../../shared/src/recipe/snapshot.ts)
- [shared/src/task/shape.ts](../../../shared/src/task/shape.ts)
- [shared/src/task/owner.ts](../../../shared/src/task/owner.ts)
- [shared/src/plan/model.ts](../../../shared/src/plan/model.ts)
- [shared/src/plan/batches.ts](../../../shared/src/plan/batches.ts)
- [shared/src/scheduler/types.ts](../../../shared/src/scheduler/types.ts)
- [shared/src/shopping/list.ts](../../../shared/src/shopping/list.ts)
