# Workspaces and modules

MiseFlow is one npm repo with three workspaces (`shared`, `server`, `web`, listed in the root
`package.json`) plus two root folders that are not workspaces: `scripts/` (dev and CI tooling) and
`e2e/` (Playwright specs). This page has three diagrams: how the workspaces depend on each other,
which `shared/src` folders the server and web code use, and how the `shared/src` folders depend on
each other.

## 1. Workspaces

```mermaid
flowchart LR
    subgraph root["repo root"]
        scripts["scripts/<br/>env.ts, checkout-ports.ts,<br/>local-only.ts, e2e-ports.ts, test-user.ts"]
        e2e["e2e/<br/>*.spec.ts"]
        pw["playwright.config.ts"]
    end

    subgraph sharedPkg["@miseflow/shared"]
        sharedIndex["src/index.ts<br/>(main: barrel export)"]
        sharedSrc["src/schema.ts and<br/>src/catalog, mutators, plan,<br/>recipe, scheduler, shopping, task"]
        sharedTest["test/walkthrough.ts"]
    end

    subgraph serverPkg["@miseflow/server"]
        serverApp["src/app.ts<br/>createApp, AppType<br/>(exports: '.')"]
        serverRoutes["src/routes/*.ts"]
        serverIndex["src/index.ts"]
        serverScripts["scripts/seed.ts,<br/>scripts/setup-local.ts"]
    end

    subgraph webPkg["@miseflow/web"]
        webApi["src/api.ts<br/>hc client"]
        webOther["src/*.ts, src/*.tsx<br/>(Gantt.tsx, plan-screen.ts, ...)"]
        vite["vite.config.ts"]
    end

    sharedIndex --> sharedSrc
    serverApp -- "dependency<br/>@miseflow/shared (barrel)" --> sharedIndex
    serverRoutes -- "@miseflow/shared (barrel)" --> sharedIndex
    serverApp --> serverRoutes
    serverIndex --> serverApp
    webOther -- "dependency<br/>deep imports @miseflow/shared/src/..." --> sharedSrc
    webApi -. "devDependency<br/>import type AppType" .-> serverApp
    serverIndex -- "load-env.ts, checkout-ports.ts" --> scripts
    serverScripts -- "env.ts, local-only.ts" --> scripts
    vite -- "checkout-ports.ts, env.ts" --> scripts
    pw --> scripts
    pw --> e2e
    e2e -- "e2e-ports.ts, local-only.ts, test-user.ts" --> scripts
    e2e -- "plan/time.ts, schema.ts" --> sharedSrc
    e2e --> sharedTest
```

- `server` and `web` both list `@miseflow/shared` as a dependency. `shared` depends on no other
  workspace. `web` lists `@miseflow/server` only as a devDependency, and uses it only for
  `import type { AppType } from "@miseflow/server"` in `web/src/api.ts`, which types the Hono
  `hc` client. No server code ships in the web bundle.
- The server imports everything from the `@miseflow/shared` barrel (`shared/src/index.ts`). The web
  never imports the barrel: it imports single files such as
  `@miseflow/shared/src/plan/axis.ts`. Some of those files (`plan/axis.ts`, `plan/lanes.ts`,
  `plan/pin.ts`, `plan/trouble.ts`, `recipe/servings.ts`) are not in the barrel at all.
- `scripts/` imports nothing from the workspaces; the workspaces, `e2e/` and
  `playwright.config.ts` import helpers from it. The root `build` script builds `shared`, then
  `web`, then `server`.

## 2. Which shared folders the server and web use

```mermaid
flowchart LR
    subgraph server["server/src"]
        sApp["app.ts"]
        sMutate["routes/mutate.ts"]
        sMenus["routes/menus.ts"]
        sRecipes["routes/recipes.ts"]
        sIngr["routes/ingredients.ts"]
        sCats["routes/shopping-categories.ts"]
        sServices["routes/services.ts"]
        sAvail["routes/availability.ts"]
        sSeed["seed.ts"]
    end

    subgraph shared["shared/src"]
        schema["schema.ts"]
        catalog["catalog/"]
        mutators["mutators/"]
        plan["plan/"]
        recipe["recipe/"]
        scheduler["scheduler/"]
        shopping["shopping/"]
    end

    subgraph web["web/src"]
        wPlan["Gantt.tsx, PrintedPlan.tsx,<br/>MenuViews.tsx, quick-fixes.ts"]
        wPlanScreen["plan-screen.ts"]
        wSteps["step-editor.ts, step-links.ts,<br/>StepForm.tsx, IngredientPicker.tsx,<br/>LinkChoice.tsx"]
        wRecipe["recipe-screen.ts, RecipeViews.tsx"]
        wMut["mutation-call.ts"]
    end

    sApp -- "mutators" --> mutators
    sMutate -- "getMutator, errors" --> mutators
    sMutate -- "appliedMutations" --> schema
    sMenus -- "menus, courses, dishes, ..." --> schema
    sMenus -- "readMenuScale, fromTimeColumn" --> plan
    sRecipes -- "readyToPlan, deriveIngredientList, ..." --> recipe
    sRecipes -- "loadCatalog" --> catalog
    sRecipes -- "recipes, steps, ingredientLines" --> schema
    sIngr -- "loadCatalog, searchCatalog" --> catalog
    sCats -- "visibleTo" --> catalog
    sCats -- "shoppingCategories" --> schema
    sServices -- "readPlan" --> plan
    sServices -- "readShoppingList" --> shopping
    sAvail -- "loadAvailability, addDays, ..." --> plan
    sSeed -- "ingredients, conversions, ..." --> schema
    sSeed -- "normaliseName" --> catalog
    sSeed -- "positionAfter" --> mutators

    wPlan -- "axis, lanes, time,<br/>batches, trouble" --> plan
    wPlanScreen -- "pin.ts" --> plan
    wPlanScreen -- "schedule" --> scheduler
    wSteps -- "match.ts, units.ts" --> catalog
    wSteps -- "tokens.ts, quantity.ts" --> recipe
    wRecipe -- "subrecipes.ts, servings.ts" --> recipe
    wMut -- "type MutationName" --> mutators
```

- Every write goes through `mutators/` (the server's `POST /mutate` route looks the mutator up with
  `getMutator`), and the web only names a mutation by type (`MutationName` in `mutation-call.ts`).
- Read routes call read functions in `shared`: `readPlan` (`plan/read.ts`), `readShoppingList`
  (`shopping/read.ts`), `readyToPlan` and `deriveIngredientList` (`recipe/`), `loadCatalog`
  (`catalog/load.ts`).
- The web reuses pure functions to work without a round trip: the Gantt chart layout
  (`plan/axis.ts`, `plan/lanes.ts`), pinning and re-scheduling locally in `plan-screen.ts`
  (`plan/pin.ts`, `scheduler/schedule.ts`), and Step text parsing (`recipe/tokens.ts`,
  `recipe/quantity.ts`, `catalog/match.ts`).
- `task/` is not imported directly by server or web code; it reaches them through `scheduler/` and
  `plan/` (the barrel exports only `ownerSchema` from `task/owner.ts`).

## 3. Dependencies between shared folders

```mermaid
flowchart TD
    mutators["mutators/<br/>define.ts (Tx, errors), registry.ts,<br/>one file per area"]
    shopping["shopping/<br/>list.ts, read.ts"]
    plan["plan/<br/>read.ts, replan.ts, model.ts, ..."]
    recipe["recipe/<br/>snapshot.ts, derive.ts, planning.ts, ..."]
    catalog["catalog/<br/>load.ts, match.ts, visibility.ts, units.ts"]
    scheduler["scheduler/<br/>schedule.ts, timeline.ts, types.ts"]
    task["task/<br/>shape.ts, owner.ts"]
    schema["schema.ts<br/>(Drizzle tables)"]

    mutators --> plan
    mutators --> recipe
    mutators --> catalog
    mutators --> scheduler
    mutators --> task
    mutators --> schema

    shopping --> plan
    shopping --> recipe
    shopping --> catalog
    shopping --> schema

    plan --> scheduler
    plan --> task
    plan --> recipe
    plan --> schema

    recipe -- "planning.ts uses normaliseName" --> catalog
    recipe --> schema
    catalog --> schema

    scheduler -- "schedule.ts uses task/shape.ts" --> task
    task -. "types only: Minute, Owner" .-> scheduler

    plan -. "Tx, NotFoundError (define.ts);<br/>batch-rows.ts uses loadSubRecipeGraph" .-> mutators
    recipe -. "type Tx" .-> mutators
    catalog -. "Tx, NotFoundError" .-> mutators
    shopping -. "type Tx" .-> mutators
```

- Solid arrows are the main direction: `mutators/` sits on top and uses the domain folders;
  `plan/` builds on `scheduler/` and `task/`; nearly everything reads tables from `schema.ts`.
- Dotted arrows go "upward" and are mostly small: the read functions in `catalog/`, `recipe/`,
  `plan/` and `shopping/` take the transaction type `Tx` and throw `NotFoundError`, both defined in
  `mutators/define.ts`. The one real function call is `plan/batch-rows.ts` calling
  `loadSubRecipeGraph` from `mutators/subrecipes.ts`.
- `scheduler/` and `task/` import each other: `scheduler/schedule.ts` uses `task/shape.ts`, while
  `task/shape.ts` and `scheduler/types.ts` share the `Minute` and `Owner` types.
- Test files (`*.test.ts`) and `scheduler/fixtures.ts` are left out of this diagram.

## Source files

- [package.json](../../../package.json)
- [shared/package.json](../../../shared/package.json)
- [server/package.json](../../../server/package.json)
- [web/package.json](../../../web/package.json)
- [playwright.config.ts](../../../playwright.config.ts)
- [shared/src/index.ts](../../../shared/src/index.ts)
- [shared/src/schema.ts](../../../shared/src/schema.ts)
- [shared/src/mutators/define.ts](../../../shared/src/mutators/define.ts)
- [shared/src/mutators/registry.ts](../../../shared/src/mutators/registry.ts)
- [shared/src/plan/read.ts](../../../shared/src/plan/read.ts)
- [shared/src/plan/replan.ts](../../../shared/src/plan/replan.ts)
- [shared/src/plan/batch-rows.ts](../../../shared/src/plan/batch-rows.ts)
- [shared/src/scheduler/schedule.ts](../../../shared/src/scheduler/schedule.ts)
- [shared/src/scheduler/types.ts](../../../shared/src/scheduler/types.ts)
- [shared/src/task/shape.ts](../../../shared/src/task/shape.ts)
- [shared/src/shopping/read.ts](../../../shared/src/shopping/read.ts)
- [shared/src/recipe/planning.ts](../../../shared/src/recipe/planning.ts)
- [shared/test/walkthrough.ts](../../../shared/test/walkthrough.ts)
- [server/src/app.ts](../../../server/src/app.ts)
- [server/src/index.ts](../../../server/src/index.ts)
- [server/src/seed.ts](../../../server/src/seed.ts)
- [server/src/routes/](../../../server/src/routes/)
- [server/scripts/setup-local.ts](../../../server/scripts/setup-local.ts)
- [web/src/api.ts](../../../web/src/api.ts)
- [web/src/Gantt.tsx](../../../web/src/Gantt.tsx)
- [web/src/plan-screen.ts](../../../web/src/plan-screen.ts)
- [web/src/step-editor.ts](../../../web/src/step-editor.ts)
- [web/src/mutation-call.ts](../../../web/src/mutation-call.ts)
- [web/vite.config.ts](../../../web/vite.config.ts)
