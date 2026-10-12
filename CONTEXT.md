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

**Service**:
A single serving of a Menu, anchored to a date, with an optional time. Make-ahead windows and deadlines are measured backward from it.
_Avoid_: Event, dinner

## Planning

**Task**:
A unit of scheduled work for a Dish: one Step by default, or several consecutive Steps grouped together. Has a duration, a Station, and at most one Cook; its progress is the progress of its Steps.
_Avoid_: To-do, job

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

**Prep view**:
The view the cook works from on the days before Service, to do the Plan rather than edit it. On a phone it shows one day at a time. On desktop it shows the prep days side by side per Cook, with a "By component" tab. A Task that is behind shows which later Tasks it holds up.
_Avoid_: Prep list (that's per Station), to-do list

**Make-ahead shelf**:
Everything made ahead for a Service, each item shown from when it's made to when it expires, measured against Service time.
_Avoid_: Fridge, inventory

**Fire**:
To start a Course during Service. The cook fires Courses by hand, one at a time, in order. A Course is **waiting**, **fired**, or **served**. Its **lead time** is about how long it takes from fire to pass.
_Avoid_: Send, call (for a Course)

**Serve straight away**:
A flag on a Step for work that can't wait between finishing and the plate (soufflé, fries, slicing the duck). Its Tasks stay locked until their Course is fired.
_Avoid_: À la minute (in the app)

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

**Pack size**:
An amount an Ingredient is sold in (cream: 250 ml, 1 L; eggs: 6, 12). The Shopping list picks the combination of packs with the least left over, then the fewest packs. An Ingredient with no pack sizes is bought **loose**.
_Avoid_: Package, SKU

**Trim loss**:
The share of an Ingredient as bought that isn't used (peel, shell, stems). It's added when a weight on the Shopping list becomes an amount to buy.
_Avoid_: Waste, refuse (outside USDA data)
