# MiseFlow

A menu planner for cooks: plan a multi-course service, break its recipes into tasks, schedule that prep backward from serving time, and buy what's needed. Single context.

## Recipes and menus

**Recipe**:
A reusable template of ingredients and steps that produces a yield. A sub-recipe (meringue, stock, sauce) is also a Recipe, referenced as a component by other Recipes.
_Avoid_: Formula

**Recipe file**:
A portable plain-text (Cooklang) snapshot of one Recipe, which MiseFlow exports and re-imports. Never the source of truth: re-importing one updates the Recipe it was exported from. A **Menu file** is the same for a Menu.
_Avoid_: Recipe source, cook file

**Revision**:
One saved state of a Recipe. Every edit makes a new Revision; past Revisions are kept, and a Recipe file records the Revision it was exported from.
_Avoid_: Version (alone)

**Import preview**:
What a re-import will do, shown before anything changes: which Recipes it updates or creates, which Step planning data is lost, and any conflicts for the cook to settle.

**Missing sub-recipe**:
An Ingredient line that refers to a sub-recipe MiseFlow can't find (deleted, or never imported). The Recipe still works, but scaling and the Shopping list skip that line until the cook links, imports, or replaces it.
_Avoid_: Broken link, dangling reference

**Step**:
One instruction within a Recipe. The smallest unit that can carry its own make-ahead window and be marked done.
_Avoid_: Instruction, stage

**Ingredient**:
A purchasable item used in a Recipe, carrying allergen and dietary tags and a default Station. Things bought as different products are different Ingredients (brown sugar and sugar), and an Ingredient can be known by several names (its aliases).
_Avoid_: Product, item

**Ingredient catalog**:
The Ingredients a kitchen can use: a shared, read-only seed plus the kitchen's own Ingredients, aliases and overrides on top. Merging two Ingredients keeps one and turns the other's name into an alias.
_Avoid_: Pantry, ingredient database

**Menu**:
A set of Courses served at one Service, with a guest count.
_Avoid_: Event, spread

**Course**:
An ordered section of a Menu (starter, main, dessert). Courses have a sequence, not a clock time.
_Avoid_: Round, plate

**Dish**:
A Recipe placed in a Course of a Menu, holding that Service's scaling, progress, and schedule.
_Avoid_: Menu item, recipe instance

**Batch**:
One making (or purchase) of a sub-recipe for a Service, with its own Scale factor, Tasks and progress, feeding one or more Dishes or parent Batches. By default a sub-recipe gets one Batch per Service, sized to everything its parents use. The cook can split a Batch (by parent, per Course, or into equal parts) and merge Batches of the same sub-recipe back; MiseFlow suggests splitting per Course when a Batch that can't be made ahead feeds several Courses, but never splits on its own. A Batch must be ready before its earliest use and keep until its latest use. It never spans two Services.
_Avoid_: Sub-recipe (for the making), prep, lot

**Bought batch**:
A Batch the cook buys ready-made instead of making. It uses the sub-recipe's **bought form**, an Ingredient in the catalog ("Puff pastry, ready-made") with its own pack sizes, Shopping category and allergen tags, and it's bought in the amount its parents use. A sub-recipe can default to bought, and each Batch can be switched between Make and Buy. A bought Batch has no Tasks and no make-ahead window; it's ready once its Shopping list row is Got. Child Batches that only feed it drop out.
_Avoid_: Shop-bought recipe, convenience product

**Service**:
A single serving of a Menu, anchored to a date, with an optional time. Make-ahead windows and deadlines are measured backward from it.
_Avoid_: Event, dinner

## Planning

**Task**:
A unit of scheduled work for a Dish, a Batch, or a Service's mise en place: one Step by default, or several consecutive Steps grouped together. Has a duration, a Station, and at most one Cook; its progress is the progress of its Steps (or, for a Mise en place task, of its Mise en place lines).
_Avoid_: To-do, job

**Mise en place task**:
A Task owned by the Service rather than a Dish or Batch: one per prep day for the whole kitchen, holding every Mise en place line used that day. The Tasks that use its lines depend on it, so the Plan places it before the earliest of them. Its duration is an estimate per line, approximate (≈) while any line uses the default. A Step marked as mise en place in the Planning pass joins it instead of its Dish's Tasks.
_Avoid_: Prep block, setup task

**Mise en place line**:
One Ingredient to weigh out or prepare for a prep day, summed by Ingredient and preparation across every Ingredient line its Tasks use that day ("shallots, brunoise: 180 g, for: Velouté, Beurre blanc"). Ticked off on its own. Sub-recipe lines are Batches, not Mise en place lines.
_Avoid_: Mise (alone), prepped ingredient

**Active time** and **passive time**:
A Step's duration in two parts. Active time needs a Cook. Passive time (baking, resting, chilling, proving) needs no Cook and can run outside Availability, such as overnight, but still holds its Equipment.
_Avoid_: Hands-on/hands-off (in the app), wait time

**Make-ahead window**:
How early before Service a Recipe, sub-recipe, or Step may be done, together with its shelf life once made. A Step's own window overrides its Recipe's; a Step without one inherits it.
_Avoid_: Advance window, prep window

**Prep-ahead task**:
A Task whose Step has a make-ahead window. Every other Task is a **last-minute task**.

**Plan**:
A suggested, editable schedule of Tasks for a Service, fitted into the Availability of the Service's Cooks while respecting dependencies and serving times.
_Avoid_: Timeline, itinerary

**Pin**:
A Task whose time the cook has fixed. Moving a Task pins it. The Plan never moves a pinned Task. If a pin breaks a rule (outside Availability, before its dependency, past shelf life), it stays where it is and shows as a conflict. Choosing a Task's Cook fixes the Cook, not the time.
_Avoid_: Lock (for time)

**Unplaced Task**:
A Task the Plan couldn't fit. It is listed with the reason it didn't fit and quick fixes. The rest of the Plan still stands.
_Avoid_: Leftover (that's food), overflow

**Re-plan**:
Fitting the Plan again after a change. While planning, it happens live after every edit, and only what must move moves. On Service day, it happens only when the cook asks. "Re-plan from scratch" ignores the previous Plan but keeps pins.

**Service day**:
The stretch from the first Task planned on the Service date until Service, or from earlier if the cook presses "Start Service day". Re-planning is on request from then on.
_Avoid_: Day-of (alone), event day

**Board**:
The view where progress is tracked: one card per Task in To do, In progress or Done, with one lane per Cook plus Unassigned. A card's column comes from its Steps, so moving a card, ticking it in the Prep view and tapping it done in the Service view all record the same progress. Moving a card never pins it. A Task in passive time stays In progress until the cook confirms its passive time is over.
_Avoid_: Kanban (in the app), tracker

**Prep view**:
The view the cook works from on the days before Service, to do the Plan rather than edit it. On a phone it shows one day at a time. On desktop it shows the prep days side by side per Cook, with a "By component" tab. A Task that is behind shows which later Tasks it holds up.
_Avoid_: Prep list (that's per Station), to-do list

**Station prep list**:
What one Station must have ready for a Service, across all prep days: one row per Batch or Dish the Station makes, with its scaled yield, what it's for, the day it's planned and when it must be ready, and that Station's Tasks for it underneath. Shown on screen and printed one page per Station; the day's Mise en place lines print as their own page.
_Avoid_: Par sheet, station sheet, prep view (that's per Cook and day)

**Make-ahead shelf**:
Everything made ahead for a Service, each item shown from when it's made to when it expires, measured against Service time.
_Avoid_: Fridge, inventory

**Fire**:
To start a Course during Service. The cook fires Courses by hand, one at a time, in order. A Course is **waiting**, **fired**, or **served**. Its **lead time** is about how long it takes from fire to pass.
_Avoid_: Send, call (for a Course)

**Serve straight away**:
A flag on a Step for work that can't wait between finishing and the plate (soufflé, fries, slicing the duck). Its Tasks stay locked until their Course is fired.
_Avoid_: À la minute (in the app)

**Handoff**:
The moment a finished Task unblocks a Task belonging to a different Cook. The chef is told who can start what next ("Stock done → Sam can start the velouté").
_Avoid_: Pass-off, relay

**Prep briefing**:
A morning summary of the day's Tasks for the whole kitchen, grouped by Cook, sent on each prep day when Availability starts.
_Avoid_: Digest, daily notification

**Availability**:
The hours a Cook is free to cook, defaulting to a kitchen-wide schedule.

**Cook**:
A named person on the account's roster who can be given Tasks, with no login of their own. The account owner is one of them. Each Service picks which Cooks are working it; a Task with no Cook is unassigned.
_Avoid_: Assignee, user, staff, helper, person

**Station**:
An area of the kitchen (pastry, garde manger, hot line) that a Task belongs to.

**Equipment**:
A named, schedulable kitchen resource (oven, burner) used by one Task at a time per unit.

## Quantities

**Quantity**:
An amount of an Ingredient with its unit: a mass (200 g), a volume (2 cups), or a count (3 eggs).
_Avoid_: Measure, amount (alone)

**Ingredient line**:
One use of an Ingredient (or of a sub-recipe) in a Recipe: a Quantity, the author's wording, and any preparation ("2 onions, diced"). Every Ingredient line links to one Ingredient, and lines add up on the Shopping list by that Ingredient. Preparation and size belong to the line, not the Ingredient.
_Avoid_: Line item, ingredient (for the line)

**Original unit**:
The unit a Recipe's author wrote a Quantity in.

**Main unit**:
The unit a Quantity is shown and totalled in. Each Ingredient has a preferred kind of measure (flour by mass, milk by volume, eggs by count), and the kitchen picks the unit for each kind (grams, millilitres). An Ingredient can override the unit (milk in litres).
_Avoid_: Base unit, default unit

**Approximate total**:
A total that includes a reference Conversion, a default piece size, or a sub-recipe that couldn't be scaled. It's marked ≈ and can explain where its number came from. Values the kitchen entered itself count as exact.
_Avoid_: Estimate (alone), guess

**Conversion**:
How a Quantity of one Ingredient turns into a different kind of measure, such as the grams in a cup of flour or the weight of one onion. Accepted reference values come first, and an Ingredient can override them.
_Avoid_: Density (unless it's specifically weight per volume)

**Fixed unit**:
A unit that converts by a constant within its kind of measure (g, kg, ml, L, tsp, tbsp, cup, oz, lb).

**Ingredient unit**:
A unit whose size depends on the Ingredient: a piece (no unit, as in "3 eggs"), clove, slice, sprig, head, stick, can, bunch. Quantities in the same Ingredient unit add up directly; turning them into another unit needs a Conversion.
_Avoid_: Count unit (alone)

**Vague amount**:
A Quantity with no number that can be summed: a pinch, a dash, a handful, to taste, or none at all. Listed, but never added into a total.

**Servings and yield**:
A Recipe's **servings** is how many people it feeds, which sets a Dish's Scale factor. Its **yield** is the Quantity it makes (500 g, 3 L, 24 cookies), which a parent Recipe divides into when using it as a sub-recipe. A sub-recipe needs a yield.
_Avoid_: Portions (for yield), batch size

**Scale factor**:
How many times a Dish makes its Recipe: the Menu's guest count over the Recipe's servings by default, or a portion count or factor the cook sets for that Dish. Quantities scale linearly by it, except fixed ones.
_Avoid_: Multiplier, batch size

**Fixed quantity**:
An Ingredient line marked not to scale (a bay leaf, salt for the pasta water). It keeps its Quantity at any Scale factor.
_Avoid_: Constant, unscaled

**Unit region**:
Which convention a Recipe's ambiguous units follow (a US cup is 236.6 ml, a metric cup 250 ml; a UK pint is 568 ml). It defaults to the kitchen's region, which also decides regional Ingredient aliases.
_Avoid_: Locale (outside Cooklang), measuring system

## Shopping

**Shopping list**:
The scaled ingredient totals for one Service, across all its Recipes and sub-recipes, optionally combined with other Services.
_Avoid_: Grocery list (in code), order

**Combined list**:
A saved, named Shopping list covering several Services ("Weekend shop"), shopped from in place of theirs. A Service's list belongs to at most one Combined list at a time. Bought and Already have amounts cover the earliest Service first, and are split that way if the Services are uncombined.
_Avoid_: Merged list, shopping trip

**Pack size**:
An amount an Ingredient is sold in (cream: 250 ml, 1 L; eggs: 6, 12). The Shopping list picks the combination of packs with the least left over, then the fewest packs. An Ingredient with no pack sizes is bought **loose**.
_Avoid_: Package, SKU

**Trim loss**:
The share of an Ingredient as bought that isn't used (peel, shell, stems). It's added when a weight on the Shopping list becomes an amount to buy.
_Avoid_: Waste, refuse (outside USDA data)

**Shopping status**:
Where a Shopping list row stands: **To buy**, **Ordered**, or **Got**. Ordered and Got record an amount, not just a tick. An Ordered row can carry an arrival time; a Task planned before it shows a conflict. A row is covered when Got plus Already have meets the need; if the need later grows, the row goes back to To buy for the shortfall only.
_Avoid_: Checked, done, purchased

**Already have**:
An amount of an Ingredient the kitchen has before shopping, entered on a Shopping list row. It comes off the need before packs are chosen.
_Avoid_: On hand (as a status), stock, inventory

**Staple**:
An Ingredient the kitchen always keeps (salt, oil, flour). Its rows start as "already have all of it", collapsed at the bottom of the Shopping list, and can be reopened.
_Avoid_: Pantry item, basic

**Shopping category**:
The section of the shop an Ingredient is bought in (Produce, Dairy & eggs, Dry goods…). Each Ingredient has one; the kitchen names and orders categories to match its shop, and the Shopping list is grouped in that order. Maps to Cooklang's aisles.
_Avoid_: Aisle (in the app), department
