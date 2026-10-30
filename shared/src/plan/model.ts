import type { Region } from "../recipe/convert.ts";
import { effectiveMakeAhead, stepGroups } from "../recipe/planning.ts";
import type { RecipeSnapshot } from "../recipe/snapshot.ts";
import { taskShape } from "../task/shape.ts";
import {
  type Interval,
  type Owner,
  type PlanningModel,
  type PreviousPlacement,
  type TaskKey,
  type TaskSpec,
  taskKey,
} from "../scheduler/types.ts";
import { deriveBatches } from "./batches.ts";
import { stepKey, type StepState } from "./progress.ts";
import { addDays, type LocalDate, weekdayOf, zonedMinute } from "./time.ts";

// Pure: the rows a re-plan reads, turned into the scheduler's PlanningModel. No drizzle here.

/** Minutes of day, `end > start`; `end` may be 1440 (midnight). */
export type Hours = { start: number; end: number };
export type WeeklyHours = { weekday: number } & Hours;
/** `hours: null`: not available that date. */
export type OverrideHours = { date: LocalDate; hours: Hours | null };

/** The Cook's free time from `from` to `to` (inclusive): each date's override if any, else its weekday's hours. */
export function freeIntervals(
  weekly: WeeklyHours[],
  overrides: OverrideHours[],
  from: LocalDate,
  to: LocalDate,
  timeZone: string,
): Interval[] {
  const byDate = new Map(overrides.map((o) => [o.date, o.hours]));
  const out: Interval[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const hours = byDate.has(date)
      ? [byDate.get(date)].filter((h): h is Hours => h != null)
      : weekly.filter((w) => w.weekday === weekdayOf(date));
    for (const h of hours) {
      out.push({
        start: zonedMinute(date, h.start, timeZone),
        end: zonedMinute(date, h.end, timeZone),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

export type PlanRows = {
  /** `time`: minute of day, or null for the kitchen's default. */
  service: { id: string; date: LocalDate; time: number | null };
  /** Resolved: the kitchen's setting, else 19:00. */
  defaultServiceTime: number;
  cookId: string;
  weekly: WeeklyHours[];
  overrides: OverrideHours[];
  guestCount: number | null;
  region: Region;
  /** In Menu order. `scaleFactor`: the Dish's override, or null. */
  dishes: {
    dishId: string;
    recipeId: string;
    scaleFactor: number | null;
    recipe: RecipeSnapshot;
  }[];
  /** The live sub-recipes the Dishes reach, by Recipe id. */
  subRecipes: Map<string, RecipeSnapshot>;
  /** The Service's live stored Batch rows. */
  batches: { batchId: string; subRecipeId: string }[];
  /** The live stored placements, as scheduler input. */
  previous: PreviousPlacement[];
  /** Each Step's progress by `stepKey`, from the Service's `step_events`; a Step with no events is absent. */
  progress: Map<string, StepState>;
};

/** What the Plan read shows for a Task, besides its placement. */
export type TaskInfo = {
  key: TaskKey;
  owner: Owner;
  /** Exactly one of `dishId` and `batchId` is set. */
  dishId: string | null;
  batchId: string | null;
  stepIds: string[];
  /** On the 5-minute grid, as the scheduler counts them; a Step with no duration counts 10 active. */
  activeMinutes: number;
  passiveMinutes: number;
  /** The last Step's passive time, rounded: a Task is due when the last Step's active time ends (#88 D5). */
  trailingPassiveMinutes: number;
  /** A Step has neither active nor passive time. */
  approximate: boolean;
};

const recipesOf = (rows: Pick<PlanRows, "dishes" | "subRecipes">) => {
  const recipes = new Map(rows.subRecipes);
  for (const d of rows.dishes) if (!recipes.has(d.recipeId)) recipes.set(d.recipeId, d.recipe);
  return recipes;
};

/** Each Dish's Scale factor and the Batches its Recipes need, sized (units spec §5). */
export function deriveScale(
  rows: Pick<PlanRows, "guestCount" | "region" | "dishes" | "subRecipes">,
) {
  return deriveBatches({
    guestCount: rows.guestCount,
    region: rows.region,
    dishes: rows.dishes.map(({ dishId, recipeId, scaleFactor }) => ({
      dishId,
      recipeId,
      scaleFactor,
    })),
    recipes: recipesOf(rows),
  });
}

/**
 * The scheduler's input for one Service. Each Dish's Step groups are its Tasks, and so are each
 * stored Batch's (a derived Batch with no row yet adds none, D8). A Task may start from its most
 * restrictive Step's make-ahead window, and a last-minute Step makes the whole Task last-minute
 * (#86 D3). A prep-ahead Task keeps for its shortest shelf life (spec §5 rule 4); the scheduler
 * checks it only on an owner's last Tasks, the finished Dish or Batch. Every Task of a
 * Batch finishes before every Task of each direct parent, a Dish or a parent Batch (D4).
 */
export function toPlanningModel(
  rows: PlanRows,
  timeZone: string,
): {
  model: PlanningModel;
  tasks: Map<TaskKey, TaskInfo>;
  scale: ReturnType<typeof deriveBatches>;
} {
  const { date } = rows.service;
  const tasks = new Map<TaskKey, TaskInfo>();
  const specs: TaskSpec[] = [];
  const links: PlanningModel["links"] = [];
  const seenLinks = new Set<string>();
  let maxBeforeDays = 0;
  const link = (before: TaskKey, after: TaskKey) => {
    const id = `${before} ${after}`;
    if (seenLinks.has(id)) return;
    seenLinks.add(id);
    links.push({ before, after });
  };

  // One owner's Tasks and its own manual links; returns its Task keys in Step order.
  const addOwner = (owner: Owner, recipe: RecipeSnapshot): TaskKey[] => {
    const stepById = new Map(recipe.steps.map((s) => [s.id, s]));
    const keyOfStep = new Map<string, TaskKey>();
    const keys: TaskKey[] = [];
    for (const group of stepGroups(recipe.steps)) {
      const key = taskKey(owner, group.keyStepId);
      const steps = group.stepIds.map((id) => stepById.get(id)!);
      const windows = steps.map((s) => effectiveMakeAhead(s, recipe));
      let earliestStart: number | null = null;
      let keepsMinutes: number | null = null;
      if (windows.every((w) => w !== null && w.beforeDays > 0)) {
        const days = Math.min(...windows.map((w) => w!.beforeDays));
        maxBeforeDays = Math.max(maxBeforeDays, days);
        earliestStart = zonedMinute(addDays(date, -days), 0, timeZone);
        // 24-hour days (D2).
        keepsMinutes = Math.min(...windows.map((w) => w!.shelfLifeDays)) * 1440;
      }
      // A done Step's tick, in whole minutes (rounded up), is frozen for the scheduler (#88).
      const doneAt = (stepId: string) => {
        const state = rows.progress.get(stepKey(owner, stepId));
        return state?.done && state.doneAt
          ? { doneAt: Math.ceil(state.doneAt.getTime() / 60_000) }
          : {};
      };
      specs.push({
        owner,
        steps: steps.map((s) => ({
          stepId: s.id,
          activeMinutes: s.activeMinutes,
          passiveMinutes: s.passiveMinutes,
          ...doneAt(s.id),
        })),
        earliestStart,
        keepsMinutes,
      });
      const shape = taskShape(steps);
      tasks.set(key, {
        key,
        owner,
        dishId: owner.kind === "dish" ? owner.dishId : null,
        batchId: owner.kind === "batch" ? owner.batchId : null,
        stepIds: group.stepIds,
        activeMinutes: shape.activeMinutes,
        passiveMinutes: shape.passiveMinutes,
        trailingPassiveMinutes: shape.trailingPassiveMinutes,
        approximate: shape.approximate,
      });
      for (const id of group.stepIds) keyOfStep.set(id, key);
      keys.push(key);
    }
    for (const d of recipe.dependencies) {
      const before = keyOfStep.get(d.beforeStepId);
      const after = keyOfStep.get(d.afterStepId);
      if (!before || !after || before === after) continue;
      link(before, after);
    }
    return keys;
  };

  const dishKeys = new Map<string, TaskKey[]>();
  for (const { dishId, recipe } of rows.dishes)
    dishKeys.set(dishId, addOwner({ kind: "dish", dishId }, recipe));

  const recipes = recipesOf(rows);
  const scale = deriveScale(rows);
  const stored = new Map(rows.batches.map((b) => [b.subRecipeId, b.batchId]));
  const batchKeys = new Map<string, TaskKey[]>();
  // Every stored Batch's Tasks first, so a child Batch can link to its parent Batch's.
  for (const b of scale.batches) {
    const batchId = stored.get(b.subRecipeId);
    if (batchId)
      batchKeys.set(
        b.subRecipeId,
        addOwner({ kind: "batch", batchId }, recipes.get(b.subRecipeId)!),
      );
  }
  for (const b of scale.batches) {
    const own = batchKeys.get(b.subRecipeId);
    if (!own) continue;
    for (const p of b.parents) {
      const parentKeys = (p.kind === "dish" ? dishKeys.get(p.id) : batchKeys.get(p.id)) ?? [];
      for (const before of own) for (const after of parentKeys) link(before, after);
    }
  }

  return {
    model: {
      service: {
        dayStart: zonedMinute(date, 0, timeZone),
        at: zonedMinute(date, rows.service.time ?? rows.defaultServiceTime, timeZone),
      },
      cooks: [
        {
          id: rows.cookId,
          free: freeIntervals(
            rows.weekly,
            rows.overrides,
            addDays(date, -maxBeforeDays),
            date,
            timeZone,
          ),
        },
      ],
      tasks: specs,
      links,
      previous: rows.previous,
    },
    tasks,
    scale,
  };
}
