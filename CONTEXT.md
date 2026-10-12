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

**Make-ahead window**:
How early before Service a Recipe, sub-recipe, or Step may be done, together with its shelf life once made. A Step's own window overrides its Recipe's; a Step without one inherits it.
_Avoid_: Advance window, prep window

**Prep-ahead task**:
A Task whose Step has a make-ahead window. Every other Task is a **last-minute task**.

**Plan**:
A suggested, editable schedule of Tasks for a Service, fitted into the Availability of the Service's Cooks while respecting dependencies and serving times.
_Avoid_: Timeline, itinerary

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
The unit a Quantity is shown and totalled in: a kitchen-wide default for each kind of measure (grams for mass, millilitres for volume), which an Ingredient can override (milk in litres, eggs by count).
_Avoid_: Base unit, default unit

**Conversion**:
How a Quantity of one Ingredient turns into a different kind of measure, such as the grams in a cup of flour or the weight of one onion. Accepted reference values come first, and an Ingredient can override them.
_Avoid_: Density (unless it's specifically weight per volume)

## Shopping

**Shopping list**:
The scaled ingredient totals for one Service, across all its Recipes and sub-recipes, optionally combined with other Services.
_Avoid_: Grocery list (in code), order
