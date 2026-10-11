# MiseFlow

A menu planner for cooks: plan a multi-course service, break its recipes into tasks, schedule that prep backward from serving time, and buy what's needed. Single context.

## Recipes and menus

**Recipe**:
A reusable template of ingredients and steps that produces a yield. A sub-recipe (meringue, stock, sauce) is also a Recipe, referenced as a component by other Recipes.
_Avoid_: Formula

**Step**:
One instruction within a Recipe. The smallest unit that can carry its own make-ahead window and be marked done.
_Avoid_: Instruction, stage

**Ingredient**:
A purchasable item used in a Recipe, carrying allergen and dietary tags and a default Station.
_Avoid_: Product, item

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
A unit of scheduled work for a Dish: one Step by default, or several consecutive Steps grouped together. Has a duration, a Station, and an assignee; its progress is the progress of its Steps.
_Avoid_: To-do, job

**Make-ahead window**:
How early before Service a Recipe, sub-recipe, or Step may be done, together with its shelf life once made. A Step's own window overrides its Recipe's; a Step without one inherits it.
_Avoid_: Advance window, prep window

**Prep-ahead task**:
A Task whose Step has a make-ahead window. Every other Task is a **last-minute task**.

**Plan**:
A suggested, editable schedule of Tasks for a Service, fitted into people's availability while respecting dependencies and serving times.
_Avoid_: Timeline, itinerary

**Availability**:
The hours a person is free to cook, defaulting to a kitchen-wide schedule.

**Station**:
An area of the kitchen (pastry, garde manger, hot line) that a Task belongs to.

**Equipment**:
A named, schedulable kitchen resource (oven, burner) used by one Task at a time per unit.

## Shopping

**Shopping list**:
The scaled ingredient totals for one Service, across all its Recipes and sub-recipes, optionally combined with other Services.
_Avoid_: Grocery list (in code), order
