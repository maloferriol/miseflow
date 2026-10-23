import { effectiveMakeAhead, stepGroups } from "../recipe/planning.ts";
import type { RecipeSnapshot } from "../recipe/snapshot.ts";
import {
  type Interval,
  type Owner,
  type PlanningModel,
  type PreviousPlacement,
  type TaskKey,
  type TaskSpec,
  taskKey,
} from "../scheduler/types.ts";
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
      out.push({ start: zonedMinute(date, h.start, timeZone), end: zonedMinute(date, h.end, timeZone) });
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
  dishes: { dishId: string; recipe: RecipeSnapshot }[];
  /** The live stored placements, as scheduler input. */
  previous: PreviousPlacement[];
};

/** What the Plan read shows for a Task, besides its placement. */
export type TaskInfo = {
  key: TaskKey;
  owner: Owner;
  dishId: string;
  stepIds: string[];
  /** On the 5-minute grid, as the scheduler counts them; a Step with no duration counts 10 active. */
  activeMinutes: number;
  passiveMinutes: number;
  /** A Step has neither active nor passive time. */
  approximate: boolean;
};

const PLACEHOLDER_ACTIVE = 10;
const roundUp = (minutes: number) => Math.ceil(minutes / 5) * 5;

/**
 * The scheduler's input for one Service. Each Dish's Step groups are its Tasks; sub-recipe lines
 * add none yet (#87). A Task may start from its most restrictive Step's make-ahead window, and a
 * last-minute Step makes the whole Task last-minute (D3). Shelf life isn't mapped (#87).
 */
export function toPlanningModel(
  rows: PlanRows,
  timeZone: string,
): { model: PlanningModel; tasks: Map<TaskKey, TaskInfo> } {
  const { date } = rows.service;
  const tasks = new Map<TaskKey, TaskInfo>();
  const specs: TaskSpec[] = [];
  const links: PlanningModel["links"] = [];
  const seenLinks = new Set<string>();
  let maxBeforeDays = 0;

  for (const { dishId, recipe } of rows.dishes) {
    const owner: Owner = { kind: "dish", dishId };
    const stepById = new Map(recipe.steps.map((s) => [s.id, s]));
    const keyOfStep = new Map<string, TaskKey>();
    for (const group of stepGroups(recipe.steps)) {
      const key = taskKey(owner, group.keyStepId);
      const steps = group.stepIds.map((id) => stepById.get(id)!);
      const windows = steps.map((s) => effectiveMakeAhead(s, recipe));
      let earliestStart: number | null = null;
      if (windows.every((w) => w !== null && w.beforeDays > 0)) {
        const days = Math.min(...windows.map((w) => w!.beforeDays));
        maxBeforeDays = Math.max(maxBeforeDays, days);
        earliestStart = zonedMinute(addDays(date, -days), 0, timeZone);
      }
      specs.push({
        owner,
        steps: steps.map((s) => ({ stepId: s.id, activeMinutes: s.activeMinutes, passiveMinutes: s.passiveMinutes })),
        earliestStart,
      });
      const unknown = (s: (typeof steps)[number]) => s.activeMinutes === null && s.passiveMinutes === null;
      tasks.set(key, {
        key,
        owner,
        dishId,
        stepIds: group.stepIds,
        activeMinutes: steps.reduce((n, s) => n + (unknown(s) ? PLACEHOLDER_ACTIVE : roundUp(s.activeMinutes ?? 0)), 0),
        passiveMinutes: steps.reduce((n, s) => n + roundUp(s.passiveMinutes ?? 0), 0),
        approximate: steps.some(unknown),
      });
      for (const id of group.stepIds) keyOfStep.set(id, key);
    }
    for (const d of recipe.dependencies) {
      const before = keyOfStep.get(d.beforeStepId);
      const after = keyOfStep.get(d.afterStepId);
      if (!before || !after || before === after) continue;
      const id = `${before} ${after}`;
      if (seenLinks.has(id)) continue;
      seenLinks.add(id);
      links.push({ before, after });
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
          free: freeIntervals(rows.weekly, rows.overrides, addDays(date, -maxBeforeDays), date, timeZone),
        },
      ],
      tasks: specs,
      links,
      previous: rows.previous,
    },
    tasks,
  };
}
