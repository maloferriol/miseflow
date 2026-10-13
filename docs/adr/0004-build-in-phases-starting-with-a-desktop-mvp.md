# Build in phases, starting with a desktop MVP

The [Menu planner spec](../menu-planner-spec.md) describes a responsive, installable, offline-capable app for a whole kitchen. Building all of it before anyone can use it is too long a road. So we build in five phases and keep the spec as the target. Phase 1 is an MVP for planning one dinner party at a desk: a web app in a desktop browser, online-only, used by one person who is the only Cook. Each later phase adds to it without a rewrite, because the MVP is built sync-ready from day one (see Consequences). Decided on map [#53](https://github.com/maloferriol/miseflow/issues/53); MVP scope frozen on [#54](https://github.com/maloferriol/miseflow/issues/54).

## The phases

1. **MVP:** plan one dinner party at your desk (scope below).
2. **Getting recipes in and out:** Cooklang export, then Cooklang import, then pasted-text and URL import through the LLM. Also the full Shopping list: pack sizes, Ordered, Already have, Staples and Combined lists. The export's `miseflow:` block is versioned from the start, and import ignores fields it doesn't know.
3. **A real kitchen:** the roster of Cooks, Stations, Equipment, the Board, the full Prep view, Station prep lists and Mise en place, printed.
4. **Phone and sync:** responsive kitchen views, the installable app, offline cache and sync, the Service view with timers, push notifications, and Service day (on-request re-plan).
5. **The rest of the spec:** Batch split and merge, Bought batches, Revision apply and Dish overrides, closed Services, and CP-SAT.

## MVP scope

| Area | In | Waits |
| --- | --- | --- |
| Recipes | Steps editor with `@` autocomplete, Create sub-recipe, Extract to sub-recipe. Every edit stores a Revision and Steps keep stable ids, but Dishes always follow the latest Revision and no history is shown | Any import (phase 2), Revision apply and Dish overrides (5) |
| Ingredient catalog and units | ODbL seed plus the kitchen's own Ingredients and aliases, linked per [ADR 0002](0002-ingredient-lines-link-to-ingredients.md). Main units, Conversions, linear and recursive scaling, Fixed quantities, Vague amounts, ≈ | Merging Ingredients, a Unit region setting (fixed to the kitchen's region), allergen and dietary tags, trim loss |
| Planning pass | Active and passive time, make-ahead windows (Recipe plus per-Step override), Task grouping, manual dependencies, ready to plan checklist | Station, Equipment (3), Mise en place flag (3), Serve straight away (4), Default to Buy (5) |
| Menus and Services | Menu with Courses and guest count, Service with date and optional time (kitchen default), per-Dish Scale factor. Several Services can exist, each planned on its own; the Cook may be double-booked across them. Past Services aren't frozen | Closed Services (5) |
| Batches | One Batch per sub-recipe per Service, sized to all its parents, labelled "×1.5 · for: …" everywhere. Shelf-life and earliest/latest-use conflicts show | Split and merge (5) |
| Cook and Availability | One implicit Cook. A weekly Availability schedule plus per-date overrides | The roster (3) |
| Scheduler and Plan | Greedy backward scheduler, live re-plan after every edit up to Service, pins, Unplaced Tasks with reasons, the 10-minute placeholder, Re-plan from scratch, Plan trouble badge. Quick fixes: give the Cook more time, unpin the blocking Task, remove the Dish. Edited on a Gantt chart | Service day (4), Cook lock (3), Add Equipment and Split this Batch quick fixes |
| Progress | A Today checklist: day tabs, Tasks in Plan time order, a tick per Step, behind Tasks in red with what they hold up, ticks feed live re-plan. Passive time ends at its planned time with no confirmation | The Board (3), the Days grid, Make-ahead shelf and By component tab (3), passive-time confirmation (4) |
| Shopping list | One per Service, a row per Ingredient grouped by the seeded Shopping categories in fixed order, scaled need in Main units with ≈, a single Got tick. Vague amounts listed without a total, Missing sub-recipes flagged | Everything else in spec §11 (2) |
| Printing | The Plan as a per-day list with tick boxes, and the Shopping list | Printing the Gantt chart; Station prep lists (3) |
| Notifications and timers | None | (4) |

## Done looks like

From a desktop browser, end to end:

1. Type in a Saturday dinner for 6. The menu is a velouté with a chicken stock sub-recipe (made with Create sub-recipe), a duck breast with beurre blanc that also uses the stock, and a tarte tatin with its pastry moved out by Extract to sub-recipe. Every Ingredient line links to the catalog, and Ingredients are created where none match.
2. In the Planning pass, set active and passive times and make-ahead windows (the stock can be made 3 days ahead and keeps 4). Ready to plan lists the Steps still missing a duration.
3. Make a Menu with three Courses and 6 guests, add a Service on Saturday at 19:30, and set Availability: Thursday and Friday evenings, all day Saturday.
4. Open the Plan. The stock lands on Thursday as one Batch, "×1.5 · for: Velouté, Beurre blanc". The pastry lands on Friday and the rest on Saturday, each as late as possible.
5. Drag the stock to Wednesday. It pins and the rest re-fits live. Shorten Friday's hours: a Task goes Unplaced with a reason, and "give the Cook more time" brings it back.
6. Print the Shopping list and tick rows Got.
7. Each day, tick Steps in the Today checklist or on its printout. A late tick shows a Task as behind and re-plans the rest.
8. Close the browser and come back. Everything is still there, saved on the server.

## Consequences

- **Sync-ready from the MVP**, so phase 4 isn't a rewrite. Ids are UUIDs created in the browser. Every write is one named mutation (`tickStep`, `pinTask`). Progress is stored as append-only events. Rows carry a version or `updatedAt`, and deletes are soft. The scheduler is a pure TypeScript function with no database access.
- Fields that wait for a later phase, such as a Step's Station, can exist in the schema before any screen shows them. Phase 3 then adds UI, not a data migration.
- Because Revisions are stored from the start, Cooklang export (phase 2) and Revision apply (phase 5) build on real history.
