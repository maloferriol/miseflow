import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Conventions from ADR 0006 and ADR 0010: ids are made in the browser,
// every row has an owner, and rows are soft-deleted where they can change.
const id = uuid("id").primaryKey();
const ownerId = uuid("owner_id");
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const deletedAt = timestamp("deleted_at", { withTimezone: true });
const position = text("position").notNull();
const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const kitchenSettings = pgTable("kitchen_settings", {
  id,
  ownerId,
  massUnit: text("mass_unit").notNull().default("g"),
  volumeUnit: text("volume_unit").notNull().default("ml"),
  countUnit: text("count_unit").notNull().default("each"),
  unitRegion: text("unit_region").notNull().default("metric"),
  defaultServiceTime: time("default_service_time"),
  updatedAt,
  deletedAt,
});

export const shoppingCategories = pgTable("shopping_categories", {
  id,
  ownerId,
  name: text("name").notNull(),
  position,
  updatedAt,
  deletedAt,
});

export const ingredients = pgTable("ingredients", {
  id,
  ownerId,
  name: text("name").notNull(),
  fdcId: text("fdc_id"),
  source: text("source", { enum: ["seed", "own"] }).notNull(),
  preferredKind: text("preferred_kind"),
  mainUnit: text("main_unit"),
  shoppingCategoryId: uuid("shopping_category_id").references(
    () => shoppingCategories.id,
  ),
  updatedAt,
  deletedAt,
});

export const ingredientAliases = pgTable(
  "ingredient_aliases",
  {
    id,
    ownerId,
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    name: text("name").notNull(),
    source: text("source", { enum: ["seed", "own"] }).notNull(),
    updatedAt,
    deletedAt,
  },
  (t) => [index("ingredient_aliases_name_idx").on(t.name)],
);

// Your changes to a seed Ingredient live here, so the ODbL seed stays untouched.
// One row per owner and Ingredient, so an override is an atomic upsert.
export const ingredientOverrides = pgTable(
  "ingredient_overrides",
  {
    id,
    ownerId,
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    mainUnit: text("main_unit"),
    shoppingCategoryId: uuid("shopping_category_id").references(
      () => shoppingCategories.id,
    ),
    updatedAt,
    deletedAt,
  },
  (t) => [unique("ingredient_overrides_owner_ingredient").on(t.ownerId, t.ingredientId)],
);

export const conversions = pgTable("conversions", {
  id,
  ownerId,
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => ingredients.id),
  fromUnit: text("from_unit").notNull(),
  toUnit: text("to_unit").notNull(),
  factor: numeric("factor").notNull(),
  source: text("source", { enum: ["seed", "own"] }).notNull(),
  updatedAt,
  deletedAt,
});

export const recipes = pgTable("recipes", {
  id,
  ownerId,
  name: text("name").notNull(),
  servings: numeric("servings"),
  // Unused since #84 (Q7): the yield is the Quantity below. Dropped in a later cleanup.
  yieldText: text("yield_text"),
  // The Quantity the Recipe makes; a sub-recipe needs one. A null unit with a quantity is pieces.
  yieldQuantity: numeric("yield_quantity"),
  yieldUnit: text("yield_unit"),
  makeAheadBeforeDays: integer("make_ahead_before_days"),
  shelfLifeDays: integer("shelf_life_days"),
  source: text("source"),
  latestRevision: integer("latest_revision").notNull().default(1),
  updatedAt,
  deletedAt,
});

// Append-only: every edit mutation writes one whole-Recipe snapshot in its transaction.
export const recipeRevisions = pgTable(
  "recipe_revisions",
  {
    id,
    ownerId,
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    number: integer("number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt,
  },
  (t) => [unique("recipe_revisions_number").on(t.recipeId, t.number)],
);

export const steps = pgTable(
  "steps",
  {
    id,
    ownerId,
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    position,
    // Tokens map one to one onto Cooklang: text, or a reference to one of this Step's lines.
    body: jsonb("body").notNull().default(sql`'[]'::jsonb`),
    activeMinutes: integer("active_minutes"),
    passiveMinutes: integer("passive_minutes"),
    makeAheadBeforeDays: integer("make_ahead_before_days"),
    shelfLifeDays: integer("shelf_life_days"),
    groupWithPrevious: boolean("group_with_previous").notNull().default(false),
    // Later-phase fields, present from the start so phase 3 adds UI, not a migration.
    stationId: uuid("station_id"),
    miseEnPlace: boolean("mise_en_place"),
    serveStraightAway: boolean("serve_straight_away").notNull().default(false),
    updatedAt,
    deletedAt,
  },
  (t) => [index("steps_recipe_idx").on(t.recipeId)],
);

export const ingredientLines = pgTable(
  "ingredient_lines",
  {
    id,
    ownerId,
    stepId: uuid("step_id")
      .notNull()
      .references(() => steps.id),
    ingredientId: uuid("ingredient_id").references(() => ingredients.id),
    // Neither ingredientId nor subRecipeId set means a Missing sub-recipe.
    subRecipeId: uuid("sub_recipe_id").references(() => recipes.id),
    quantity: numeric("quantity"),
    // The upper end of a range ("2-3"); null for a single amount.
    quantityMax: numeric("quantity_max"),
    unit: text("unit"),
    wording: text("wording"),
    preparation: text("preparation"),
    fixedQuantity: boolean("fixed_quantity").notNull().default(false),
    position,
    updatedAt,
    deletedAt,
  },
  (t) => [
    check(
      "ingredient_lines_one_target",
      sql`${t.ingredientId} is null or ${t.subRecipeId} is null`,
    ),
  ],
);

export const stepDependencies = pgTable(
  "step_dependencies",
  {
    id,
    ownerId,
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    // Finish-to-start: `before` must finish before `after` starts.
    beforeStepId: uuid("before_step_id")
      .notNull()
      .references(() => steps.id),
    afterStepId: uuid("after_step_id")
      .notNull()
      .references(() => steps.id),
    updatedAt,
    deletedAt,
  },
  (t) => [unique("step_dependencies_pair").on(t.beforeStepId, t.afterStepId)],
);

export const menus = pgTable("menus", {
  id,
  ownerId,
  name: text("name").notNull(),
  guestCount: integer("guest_count"),
  updatedAt,
  deletedAt,
});

export const courses = pgTable("courses", {
  id,
  ownerId,
  menuId: uuid("menu_id")
    .notNull()
    .references(() => menus.id),
  name: text("name").notNull(),
  position,
  updatedAt,
  deletedAt,
});

// One Service per Menu in the MVP. Dropping the unique constraint later allows several.
export const services = pgTable("services", {
  id,
  ownerId,
  menuId: uuid("menu_id")
    .notNull()
    .unique()
    .references(() => menus.id),
  date: date("date").notNull(),
  time: time("time"),
  updatedAt,
  deletedAt,
});

export const dishes = pgTable("dishes", {
  id,
  ownerId,
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id),
  position,
  scaleFactor: numeric("scale_factor"),
  updatedAt,
  deletedAt,
});

export const batches = pgTable(
  "batches",
  {
    id,
    ownerId,
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    subRecipeId: uuid("sub_recipe_id")
      .notNull()
      .references(() => recipes.id),
    updatedAt,
    deletedAt,
  },
  (t) => [unique("batches_service_sub_recipe").on(t.serviceId, t.subRecipeId)],
);

export const cooks = pgTable("cooks", {
  id,
  ownerId,
  name: text("name").notNull(),
  updatedAt,
  deletedAt,
});

export const availabilityWeekly = pgTable("availability_weekly", {
  id,
  ownerId,
  cookId: uuid("cook_id")
    .notNull()
    .references(() => cooks.id),
  // 0 = Sunday … 6 = Saturday
  weekday: integer("weekday").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  updatedAt,
  deletedAt,
});

// A null start and end means the Cook is unavailable that date.
export const availabilityOverrides = pgTable("availability_overrides", {
  id,
  ownerId,
  cookId: uuid("cook_id")
    .notNull()
    .references(() => cooks.id),
  date: date("date").notNull(),
  startTime: time("start_time"),
  endTime: time("end_time"),
  updatedAt,
  deletedAt,
});

// One placement per placed Task. A Task is keyed by its Dish or Batch and first Step.
export const taskPlacements = pgTable(
  "task_placements",
  {
    id,
    ownerId,
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    dishId: uuid("dish_id").references(() => dishes.id),
    batchId: uuid("batch_id").references(() => batches.id),
    firstStepId: uuid("first_step_id")
      .notNull()
      .references(() => steps.id),
    startMinute: integer("start_minute").notNull(),
    cookId: uuid("cook_id").references(() => cooks.id),
    pinned: boolean("pinned").notNull().default(false),
    updatedAt,
    deletedAt,
  },
  (t) => [
    check(
      "task_placements_one_owner",
      sql`(${t.dishId} is null) <> (${t.batchId} is null)`,
    ),
    unique("task_placements_task")
      .on(t.serviceId, t.dishId, t.batchId, t.firstStepId)
      .nullsNotDistinct(),
  ],
);

// Append-only. A Step's state is its latest event.
export const stepEvents = pgTable(
  "step_events",
  {
    id,
    ownerId,
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    dishId: uuid("dish_id").references(() => dishes.id),
    batchId: uuid("batch_id").references(() => batches.id),
    stepId: uuid("step_id")
      .notNull()
      .references(() => steps.id),
    // MVP writes `done` and `undone`; phase 4 adds more.
    kind: text("kind", { enum: ["done", "undone"] }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "step_events_one_owner",
      sql`(${t.dishId} is null) <> (${t.batchId} is null)`,
    ),
    index("step_events_service_idx").on(t.serviceId),
  ],
);

export const shoppingMarks = pgTable(
  "shopping_marks",
  {
    id,
    ownerId,
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    // The MVP writes only `got`.
    status: text("status", { enum: ["got", "ordered", "already_have"] }).notNull(),
    amount: numeric("amount"),
    updatedAt,
    deletedAt,
  },
  (t) => [unique("shopping_marks_line").on(t.serviceId, t.ingredientId)],
);

// Append-only. One row per applied named mutation, so a retried mutation id is applied once
// (ADR 0007). Its id is the mutation's id. Claimed inside the mutation's own transaction.
export const appliedMutations = pgTable("applied_mutations", {
  id,
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
