# Menu planner spec

What MiseFlow does, end to end: Recipes and Menus, turning them into Tasks, scheduling those Tasks backward from Service, the views a kitchen works from, and the Shopping list. Assembled from map [#1](https://github.com/maloferriol/miseflow/issues/1); each section links the ticket that decided it, and the ticket holds the full reasoning. Terms are defined in [CONTEXT.md](../CONTEXT.md).

Two areas have their own, more detailed specs, which this one summarises and links rather than repeats:

- [Recipe import/export spec](recipe-import-export-spec.md): Cooklang files, Revisions and Step identity (map [#14](https://github.com/maloferriol/miseflow/issues/14)).
- [Units and quantities spec](units-and-quantities-spec.md): units, the Ingredient catalog, Conversions, scaling and Shopping list totals (map [#25](https://github.com/maloferriol/miseflow/issues/25)).

## 1. Product baseline

Decided while charting the map.

- **Platform.** A responsive web app, installable so it can send notifications. Desktop is for planning, the phone is for the kitchen.
- **Data.** Cloud-synced with an offline cache. The database is canonical for Recipes and Menus; Cooklang `.cook` / `.menu` files are export and re-import snapshots ([#2](https://github.com/maloferriol/miseflow/issues/2), [#3](https://github.com/maloferriol/miseflow/issues/3), [ADR 0001](adr/0001-database-canonical-cooklang-for-export.md)).
- **Accounts.** Single-user accounts in v1. Team sharing comes in a later effort.
- **The core loop.** Write Recipes → place them as Dishes in the Courses of a Menu for a Service → MiseFlow breaks them into Tasks and suggests a Plan → the kitchen preps from the Prep view and Station prep lists, cooks the Service from the Service view, and shops from the Shopping list.

## 2. Recipes

### Model

- A **Recipe** is a reusable template of Ingredient lines and Steps with servings and a yield. A sub-recipe (stock, meringue, sauce) is a Recipe too, used as an Ingredient line in another Recipe, recursively. A sub-recipe needs a yield.
- A **Step** is the smallest unit that can carry planning data and be marked done. Steps keep a stable id across edits.
- Every edit makes a new **Revision**; past Revisions are kept ([import/export spec §2](recipe-import-export-spec.md#2-identity)).
- Every Recipe records its source (a URL or "pasted") and import date, shown on the Recipe and exported under `miseflow:` ([#4](https://github.com/maloferriol/miseflow/issues/4)).
- **Allergen and dietary tags** sit on Ingredients and are derived up through Recipes to Dishes, plus free-text notes.

### Ways in

([#4](https://github.com/maloferriol/miseflow/issues/4))

1. **The editor is Steps only.** Ingredient lines are written inside their Step with `@` autocomplete and shown as chips; the ingredient list is derived from the Steps. This matches Cooklang one to one.
   - `@` searches Recipes as well as Ingredients; a sub-recipe's amount is in its yield unit.
   - A new name offers **Create sub-recipe** (an empty draft Recipe). Selected Steps can be moved out with **Extract to sub-recipe**.
   - Each Ingredient line links to one catalog Ingredient, by exact name or alias, otherwise the cook confirms a near match or creates a new Ingredient ([ADR 0002](adr/0002-ingredient-lines-link-to-ingredients.md)).
2. **Pasted text and URLs** go through a server-side LLM that turns them into Cooklang, then through the normal Import preview, new-Ingredient handling and sub-recipe resolver. Ingredients that couldn't be placed in a Step are flagged in the preview. Importing needs a connection; there's no rule-based fallback. URL import uses the page's schema.org Recipe data.
3. **Pasted Cooklang and `.cook` files** follow the [import/export spec](recipe-import-export-spec.md#4-import).

There is no raw Cooklang editing in the app.

### Planning pass

([#4](https://github.com/maloferriol/miseflow/issues/4), [#13](https://github.com/maloferriol/miseflow/issues/13), [#42](https://github.com/maloferriol/miseflow/issues/42), [#44](https://github.com/maloferriol/miseflow/issues/44))

After the text is written, a separate Planning pass sets what the scheduler needs:

| Field | Where | Notes |
| --- | --- | --- |
| Active time | Step | Pre-filled from Cooklang timers |
| Passive time | Step | Pre-filled from timers on words like bake, rest, chill |
| Make-ahead window | Recipe, optional per-Step override | Earliest start before Service plus shelf life once made. A Step's window overrides its Recipe's |
| Station | Step | Inherited from its Ingredients' default Station, overridable |
| Equipment | Step | Named units (oven, burner) |
| Serve straight away ⚡ | Step | Locks its Tasks until the Course is fired (§9) |
| Mise en place | Step | Moves the Step's work into the day's Mise en place task (§8) |
| Task grouping | Consecutive Steps | One Task by default per Step; consecutive Steps can be grouped |
| Manual dependency | Between Steps | On top of the sub-recipe graph |
| Default to Buy, bought form | Sub-recipe | §3, Bought batches |

A **ready to plan** checklist lists what's missing (Steps with no duration) and likely duplicates (a "Dice the shallots" Step next to a "shallots, diced" line). A Recipe can be planned with gaps: see the 10-minute placeholder in §5.

## 3. Menus, Services, Dishes and Batches

### Menus and Services

- A **Menu** is a set of ordered **Courses** with a guest count. Courses have a sequence, never a clock time.
- A **Service** is one serving of a Menu, with a date and an optional time. A Service with no time uses a kitchen-wide default (for example 19:00). Everything is scheduled backward from it ([#13](https://github.com/maloferriol/miseflow/issues/13)).
- A Service is **closed** once its time has passed or every Course is served. Its Dishes and Batches freeze at the Revisions they used, with their scaling, progress and Shopping list. "Cook again" starts a new Service from the latest Revisions ([#20](https://github.com/maloferriol/miseflow/issues/20)).

### Dishes

- A **Dish** is a Recipe placed in a Course. It holds that Service's Scale factor, progress and schedule. Scaling is linear from servings and yield, recursive through sub-recipes, and rounded up to amounts you can buy ([units spec §5](units-and-quantities-spec.md#5-scaling)).

### Batches

([#43](https://github.com/maloferriol/miseflow/issues/43))

- A **Batch** is one making of a sub-recipe for a Service, with its own Scale factor, Tasks and progress, feeding one or more Dishes or parent Batches. By default there's one Batch per sub-recipe per Service, sized to everything its parents use. Unshared sub-recipes are Batches too.
- The cook can **split** a Batch (by parent, per Course, or into n equal parts) and **merge** Batches of the same sub-recipe. Both re-plan live. Merging a Batch with done Tasks is refused.
- A Batch must be ready before its **earliest** use and keep until its **latest**. A shortfall is a conflict with a **Split this Batch** quick fix. The Plan never splits on its own.
- A Batch whose parents sit in different Courses offers **Split per Course**. If it has a Serve-straight-away Step, sharing it across Courses is a conflict; otherwise it's only a suggestion.
- Batches never span two Services.
- **Everywhere a Batch shows** it reads "Chicken stock ×1.5 · for: Soup, Sauce". The Board has one card per Batch Task; a Dish filter shows it under every Dish it feeds. A Dish's progress includes the Batches it uses.

### Bought batches

([#44](https://github.com/maloferriol/miseflow/issues/44))

- Each Batch is **Make** or **Buy**. A sub-recipe can default to Buy; each Batch can be switched for one Service. Buying some and making the rest is a split.
- A sub-recipe names one catalog Ingredient as its **bought form** ("Puff pastry, ready-made") with its own pack sizes, Shopping category and allergen tags. While a Batch is bought, its Dishes' tags derive from the bought form and any difference from homemade shows on the Dish. Switching to Buy with no bought form asks the cook to pick or create one.
- **Amount:** the parents' use as-is, in the Main unit. Pack sizes apply, trim loss doesn't. A unit mismatch goes through the sub-recipe's Conversion (≈).
- A bought Batch has no Tasks, no make-ahead window and no place on the Make-ahead shelf, Plan or Station prep lists. It's ready, and counts as done, once its Shopping list row is Got. Its own shelf life isn't tracked in v1.
- **Make → Buy:** with nothing done, its Tasks, pins and Mise en place lines drop out; with Steps done, the cook confirms and progress is kept but hidden. On the Shopping list the sub-recipe's Ingredients are swapped for the product; rows already Got stay Got and show "more than needed". **Buy → Make:** Tasks return with any kept progress and re-plan live.
- Child Batches that only feed a bought Batch drop out; one that also feeds something else shrinks to what's still needed.

### When a Recipe changes

([#20](https://github.com/maloferriol/miseflow/issues/20))

1. **While planning**, Dishes and Batches follow the latest Revision and re-plan live.
2. **From Service day**, a new Revision waits as "Recipe changed: apply?", with a preview of Task changes, Shopping deltas and new conflicts. **Apply** or **Not this Service**; the next Service uses the latest either way.
3. A dismissible **Recipe changed** note lists Steps added, removed or changed and Quantities up or down. It counts in the Plan trouble badge.
4. **Done work stays.** A removed done Step stays as greyed history, out of progress. A changed done Step stays done, labelled "done on Revision N". A Step added before Steps already done is a conflict, with **Skip for this Service** or **Do it anyway**. Ingredient lines in done Steps keep the amount they were done with; the Shopping list reopens shortfalls and shows excess.
5. **Dish overrides.** Editing from inside a Dish or Batch asks "Change the Recipe" or "Only for this Service". An override can skip a Step or change a Quantity or a duration, nothing more. If a later Revision removes the Step, the override drops; if it changes the overridden value, the override stays and is flagged. An override on a Batch affects every Dish it feeds.

## 4. Cooks, Stations and Equipment

- **Cooks** ([#6](https://github.com/maloferriol/miseflow/issues/6)). A Cook is a named person with no login, on one roster per account; the account owner is one of them. Each Service picks its Cooks. Each Cook has their own **Availability**, defaulting to a kitchen-wide schedule. A Task has zero or one Cook; two people on one job is a matter of grouping or splitting Steps. Per-Cook views are a filter and a printout, not share links.
- **Stations** ([#13](https://github.com/maloferriol/miseflow/issues/13)). Every Task has exactly one Station, inherited from its Ingredients. Stations are labels with no capacity, used for grouping, Station prep lists and Cook affinity.
- **Equipment** ([#13](https://github.com/maloferriol/miseflow/issues/13)). Named units that hold one Task at a time, through active and passive time. Physical limits are modelled here, not on Stations. A bigger Batch is still one Task per unit.

## 5. Tasks and the scheduler

### Tasks

- A **Task** is scheduled work for a Dish, a Batch, or the Service's mise en place: one Step by default, or several consecutive Steps grouped. It has a duration, a Station and at most one Cook. Its progress is its Steps' progress.
- A Task is **prep-ahead** if its Step has a make-ahead window, otherwise **last-minute**.
- **Dependencies** come from the sub-recipe graph plus manual links between Steps. They're finish-to-start, passive time included (the stock is cooled before the sauce starts).

### Constraint rules

([#13](https://github.com/maloferriol/miseflow/issues/13))

1. **Active time** needs a Cook and runs inside that Cook's Availability, never split across a gap. **Passive time** needs no Cook, can run outside Availability (overnight), and holds its Equipment.
2. The Plan uses a **5-minute grid**. Views may round for display.
3. Last-minute Tasks start on the Service date and finish by Service time. Nothing is scheduled during service itself; firing Courses belongs to the Service view.
4. A prep-ahead result must still be within its shelf life when used, by its dependent Task or at Service.
5. A Step with no duration gets a **10-minute active-time placeholder**. Its Task shows ≈ and the Plan is marked approximate until it's filled in.

### What the Plan optimises

In priority order:

1. Fit as many Tasks as possible.
2. When re-planning, stay close to the previous Plan. Pins never move.
3. Schedule as late as possible before Service, within make-ahead windows and shelf life.
4. Balance load across the Service's Cooks, preferring to give one Cook all of a Station's Tasks.

"Fewer days with prep" is not an objective: late scheduling already clusters the work.

### Engine

([#7](https://github.com/maloferriol/miseflow/issues/7), [research](https://github.com/maloferriol/miseflow/blob/research/scheduling-approach/research/scheduling-approach.md))

- Our own **backward greedy list scheduler** in TypeScript, in the browser and on the server, offline included. It re-plans around pins in milliseconds, deterministically, and gives a reason for each Task that didn't fit.
- **OR-Tools CP-SAT on the server** when a better Plan is needed. No action exposes it yet: the prototype showed greedy can leave a Task unplaced when a valid Plan exists, but the cook declined a "Try harder" action for now and relies on the quick fixes ([#8](https://github.com/maloferriol/miseflow/issues/8)).
- Explanations are our own code: deterministic pre-checks (chains too long for their window, shelf life too short, Cooks with no Availability) plus the greedy blocker, phrased as domain sentences.

## 6. Editing the Plan

([#8](https://github.com/maloferriol/miseflow/issues/8), [prototype](https://github.com/maloferriol/miseflow/blob/prototype/plan-editing/prototypes/plan-editing.prototype.html))

1. **Gantt chart.** The Plan is edited on a Gantt chart across days, with one lane per Cook and per Equipment unit, active time solid and passive time hatched.
2. **Live re-plan while planning.** Every edit re-fits the rest of the Plan at once, and only what must move moves. The Task just edited goes first.
3. **On request on Service day.** An edit lands on its own, clashes show as conflicts, and a banner previews what a Re-plan would do ("would move 3 Tasks, fit 1"). Service day starts at the first Task planned on the Service date, or earlier with **Start Service day** ([#40](https://github.com/maloferriol/miseflow/issues/40)).
4. **Pins.** Moving a Task pins it. Reassigning a Task fixes its Cook (🔒), not its time. Pins never move, even when they break a rule (outside Availability, before a dependency, past shelf life); they show as conflicts and the Plan fits around them.
5. **Unplaced Tasks.** When not everything fits, the Plan stays partial. Each Unplaced Task gives a plain reason ("No Cook has 20 free minutes between Fri 00:00 and Fri 19:50") and quick fixes: give a Cook more time, add Equipment, unpin the blocking Task, remove the Dish.
6. **Extra time only pulls in Unplaced Tasks.** Placed Tasks stay put. **Re-plan from scratch** (as late as possible again, pins kept) runs only on request.
7. **Plan trouble** (Unplaced Tasks, conflicts, Recipe changed notes) is an in-app badge.

## 7. Progress and the Board

([#40](https://github.com/maloferriol/miseflow/issues/40), [prototype](https://github.com/maloferriol/miseflow/blob/prototype/kanban-board/prototypes/kanban-board.prototype.html))

- **One progress state, on Steps.** The Board, the Prep view's checkbox, Station prep lists and the Service view's one-tap done all record the same Step progress. There is no separate board state.
- **The Board** has one card per Task in **To do / In progress / Done**, one lane per Cook plus Unassigned, and a Cook filter. Grouped Tasks show their Steps on the card (● done, ◐ in progress, ⏳ passive, ○ to do). Between Steps a card stays In progress, with "next Step waiting for <Cook>".
- **Passive time** keeps a card In progress with a badge in the Step's own words ("⏳ simmering until 21:10") and shows its Cook as free. It ends only when the cook confirms; when time's up the card shows ⏰ and dependent Tasks keep slipping until someone confirms.
- **Moving a card records what happened** (started at, passive from, done at) and never pins. Progress feeds re-planning: live on prep days, on request on Service day. Dragging back undoes the last change; To do → Done is allowed, timed now.
- A Prep view tick means "the hands-on part of the current Step is done"; passive time starts then.

## 8. Prep: the Prep view, Station prep lists and mise en place

### Prep view

([#10](https://github.com/maloferriol/miseflow/issues/10), [prototype](https://github.com/maloferriol/miseflow/blob/prototype/prep-view/prototypes/prep-view.prototype.html))

What the cook works from on prep days: for doing the Plan, not editing it.

- **Phone, Today list.** One day at a time with day tabs. A **Now** group (late Tasks, running oven and resting times), the rest of the day in time order, a **Ready in the fridge** strip with how long each item keeps, and a folded preview of tomorrow with each Cook's hours. Checkbox ticks; Cook filter at the top.
- **Desktop, Days grid.** One column per prep day split by Cook, each showing hours used ("1h 50 of 4h 30"). Below it, the **Make-ahead shelf** timeline: each item cooking or resting (hatched), then ready until expiry (green), with lines for now and Service. Items expiring before Service are flagged; a Batch's bar has a tick at each use.
- **Desktop, By component tab.** A "Ready for Saturday?" bar, then Course → Dish → each make-ahead item with its Tasks chained across days and its ready or expiry status. Day-of Tasks at the end.
- **Behind** Tasks are red ("behind · was due 19:25") and show what they hold up. Live re-plan moves the rest.

### Station prep lists

([#42](https://github.com/maloferriol/miseflow/issues/42), [#50](https://github.com/maloferriol/miseflow/issues/50))

A par list of what one Station must have ready for the Service, across every prep day. Organised by place, where the Prep view is by person and day.

- **One row per Batch or Dish** the Station makes: scaled yield in Main units (≈ when approximate), "for: <Dishes>", planned day, ready-by, and that Station's Tasks as sub-rows with the Cook's initials. Sorted by day, then Plan time; a day filter narrows it. A Batch with Tasks on two Stations appears on both, each with its own Tasks. Ingredient Quantities aren't shown.
- **Progress** is shared: ticking a sub-row ticks its Steps. An item is done when all its Tasks on this Station are. Behind items are red. A Cook filter dims, not hides.
- A read-only **From mise en place** section at the top shows the Station's share of that day's Mise en place lines, ready once each is ticked.
- **Screen and print.** "Prep lists" on the Service has a tab per Station with Tasks plus a Mise en place tab per prep day. **Print all** gives one page per Station and one Mise en place page per day, with empty tick boxes and a "printed at" time.

### Mise en place

([#42](https://github.com/maloferriol/miseflow/issues/42), [#50](https://github.com/maloferriol/miseflow/issues/50))

- **Mise en place lines.** Every Ingredient line a day's Tasks use, summed by Ingredient and preparation ("shallots, brunoise: 180 g, for: Velouté, Beurre blanc"). Vague amounts are listed without a total. Sub-recipe lines are Batches, not mise en place. Each line is ticked on its own, on the Mise en place page only.
- A line's **destination** is the Station of the Tasks that use it, split by share when there are several ("→ hot line 120 g · garde manger 60 g"). It's derived, with no setting of its own; the Ingredient's default Station plays no part.
- **Mise en place task.** One per prep day for the whole kitchen, owned by the Service. Tasks using its lines depend on it, so the Plan places it before the earliest of them. It has a Cook, a Station, a Board card, a Gantt bar, Handoffs and Unplaced handling like any Task. Its duration is a per-line estimate (a default, overridable per Ingredient + preparation and on the task), ≈ while any line uses the default. In progress after the first tick, Done when every line is ticked.
- The Mise en place page is grouped by Ingredient in the order lines are first needed, with destinations on each row.

## 9. Service view

([#9](https://github.com/maloferriol/miseflow/issues/9), [prototype](https://github.com/maloferriol/miseflow/blob/prototype/service-view/prototypes/service-view.prototype.html), variant A)

A phone run sheet for service itself.

- **Layout.** One scrolling list grouped by Course in order. A **Before service** group comes first and keeps the Plan's clock times for last-minute Tasks; Course Tasks have no clock times. A served Course collapses. A last-minute Batch sits under the earliest Course it feeds, "also for: <Course>"; prep-ahead Batches stay under Before service.
- **Firing.** Courses are fired by hand, one at a time, in order, from a sticky **Fire <next Course>** bar showing the Course's lead time (roughly fire to pass) and which Courses are still out. Firing can be undone. A Course is **Waiting**, **Fired** or **Served**; marking it served marks its Tasks done.
- **Serve straight away ⚡** Tasks stay locked until their Course is fired.
- **Done** is one tap with an Undo toast.
- **Timers** are started by hand from a Task with passive time, shown in its row and in a tray at the top. At zero the row flashes and the phone vibrates; +1 min adds time.
- **Cook filter** chips at the top.

## 10. Notifications

([#11](https://github.com/maloferriol/miseflow/issues/11))

In-app timers plus browser push. The chef is the only user: every notification goes to all their signed-in devices, dismissing on one clears the others, and each names the Cook involved so the chef can relay.

| Event | When | Actions |
| --- | --- | --- |
| Timer finished | Rings until dismissed. Never held, never grouped | Stop · +5 min |
| Passive time up (unconfirmed) | At planned end, then every 10 min up to 3 more while dependent Tasks slip | Confirm done · Extend 10 min |
| Task due to start | Service day only, at planned start, naming the Cook | Mark started |
| Prep briefing | Each prep day when kitchen-wide Availability starts; whole kitchen grouped by Cook | Open Today |
| Make-ahead expiring | As soon as an item is predicted to pass its shelf life before Service | Open in Prep view |
| Handoff | A finished Task unblocks a different Cook's Task ("Stock done → Sam can start the velouté") | Mark started |
| Plan trouble | In-app badge only, no push | — |

- Not notified: "behind schedule" (covered by Task due and Handoff) and Course lead times.
- Events outside Availability are held until it starts and arrive phrased as overdue ("Brioche proof finished at 03:00"), except hand-started timers and anything on Service day.
- Events in the same minute are grouped, except timers.
- Settings: an on/off per event plus a master mute. No per-Service overrides.

## 11. Shopping

([#12](https://github.com/maloferriol/miseflow/issues/12); totals, pack sizes and trim loss in [units spec §6](units-and-quantities-spec.md#6-shopping-list))

- **One Shopping list per Service**, one row per Ingredient, grouped by Shopping category. Each row shows the need and what to buy.
- **Statuses: To buy → Ordered → Got**, each recording an amount. One tap marks Got with the suggested amount; long-press edits it ("got 1 L").
- **Already have** is an amount taken off the need before packs are chosen, with a one-tap "have all of it".
- A row is covered when Got + Already have meets the need. If the need grows, it goes back to To buy **for the shortfall only**, flagged ("buy 250 ml more"). If the need drops, it shows the surplus.
- **Ordered** can carry an arrival time. A Task using that Ingredient planned before it shows a conflict (a warning, not a scheduler constraint).
- **Staples** (a kitchen-wide flag: salt, oil, flour) start as already have, collapsed at the bottom, and can be reopened. There's no tracked pantry.
- **Shopping categories** are MiseFlow's own, one per Ingredient, seeded from Produce, Meat & fish, Dairy & eggs, Bakery, Dry goods, Spices, Frozen, Drinks, Other. The kitchen renames, adds and reorders them. They map to Cooklang `aisle.conf` on import and export.
- **Combined lists** are saved and named ("Weekend shop"). A Service's list belongs to at most one at a time and is shopped from there. Bought and Already have amounts cover the earliest Service first, and uncombining splits them in that order. A new Service can join an existing Combined list.
- A **bought Batch** appears as its product (§3).

## 12. Out of scope

From map [#1](https://github.com/maloferriol/miseflow/issues/1). Each is a possible later effort.

- Supplier and cost tracking.
- Multi-user team sharing and permissions, including linking a Cook to a real account ([#6](https://github.com/maloferriol/miseflow/issues/6)).
- Tech stack and sync implementation (engineering, not product spec).
- Recipe import from photos (OCR) or other apps' exports, and raw Cooklang editing ([#4](https://github.com/maloferriol/miseflow/issues/4)).
- Per-Course serving times. Courses are ordered only.
- Temperatures and timers in the Main or Original unit.
- A tracked pantry inventory (`pantry.conf`) and suggesting when to buy ([#12](https://github.com/maloferriol/miseflow/issues/12)).
- Batches spanning several Services ([#43](https://github.com/maloferriol/miseflow/issues/43)).
- A bought product's own shelf life ([#44](https://github.com/maloferriol/miseflow/issues/44)).

## Open for iteration

Observed while deciding, not decided. Worth revisiting once there's a build to react to.

- Greedy scheduling can miss a feasible Plan; a "Try harder" action using CP-SAT was declined for now ([#8](https://github.com/maloferriol/miseflow/issues/8)).
- Ticking a Task late in the Prep view pushes "ready at" later; whether that shifts the Plan beyond live re-plan is a scheduler detail ([#10](https://github.com/maloferriol/miseflow/issues/10)).
- Giving each Mise en place line a Station where it's prepared (rather than its destination) was deferred ([#42](https://github.com/maloferriol/miseflow/issues/42), [#50](https://github.com/maloferriol/miseflow/issues/50)).
