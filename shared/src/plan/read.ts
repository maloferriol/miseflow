import { stepPlainText } from "../recipe/planning.ts";
import { conflictsOf, schedule } from "../scheduler/schedule.ts";
import type {
  Conflict,
  Owner,
  PlanningModel,
  TaskKey,
  UnplacedReason,
} from "../scheduler/types.ts";
import type { Tx } from "../mutators/define.ts";
import { formatFactor, toBatchRead, type BatchRead } from "./batches.ts";
import { behindTasks } from "./behind.ts";
import { type TaskInfo, toPlanningModel } from "./model.ts";
import { stepKey } from "./progress.ts";
import { describeConflict, describeUnplaced } from "./reasons.ts";
import { findLiveService, loadPlanRows, type LoadedRows } from "./replan.ts";
import { formatInstant, formatMinuteOfDay, type LocalDate, localParts } from "./time.ts";

// The Plan read: the stored Plan, laid out for the browser. `planReadOf` is pure over the loaded
// rows; `readPlan` is the database caller.

export type PlanTask = {
  key: TaskKey;
  /** What `tickStep` takes. */
  owner: Owner;
  /** null on a Batch's Task. */
  dish: { id: string; name: string } | null;
  batch: { id: string; label: string } | null;
  /** `doneAt`: the tick's time in the kitchen's zone ("19:40"). */
  steps: { id: string; text: string; done: boolean; doneAt: string | null }[];
  /** Every Step is done. */
  done: boolean;
  /** Past due with a Step not done (#88 D5); `label`: "<Dish or Batch label> · <Step texts>". */
  behind: { dueAt: string; dueDate: LocalDate; holdsUp: { key: TaskKey; label: string }[] } | null;
  start: string;
  /** The start as a Minute, for the Gantt chart's axis. */
  startMinute: number;
  end: string;
  endDate: LocalDate;
  activeMinutes: number;
  passiveMinutes: number;
  approximate: boolean;
  pinned: boolean;
};

export type PlanRead = {
  service: { id: string; menuId: string; date: LocalDate; time: string; timeIsDefault: boolean };
  /** The kitchen's IANA zone, for "Printed at" and the Gantt chart's axis. */
  timeZone: string;
  /**
   * The scheduler's input over the stored Plan (`previous` by key), so the browser can run the same
   * scheduler for an optimistic re-plan (#89); the stored Plan still wins (ADR 0010).
   */
  model: PlanningModel;
  /** When behind was measured ("Sat 31 Oct 17:35"). */
  asOf: string;
  /** Any placed Task is approximate. */
  approximate: boolean;
  /** Days in the kitchen's zone, Tasks by start. */
  days: { date: LocalDate; tasks: PlanTask[] }[];
  /** The Service's live Batches, sized on read, in Menu order of first use. */
  batches: BatchRead[];
  unplaced: {
    key: TaskKey;
    dish: { id: string; name: string } | null;
    batch: { id: string; label: string } | null;
    steps: { id: string; text: string }[];
    kind: UnplacedReason["kind"];
    sentence: string;
    /** The pin that leaves no room, for "Unpin <label>" (`BlockedByPin` only); label "Chill the pastry (Tarte tatin)". */
    blockingPin: { owner: PlanTask["owner"]; firstStepId: string; label: string } | null;
    /** For "Remove <Dish>": the Task's Dish, or every top-level Dish a Batch's Task feeds, in Menu order. */
    dishes: { id: string; name: string }[];
    /** "Give the Cook more time" can help: not for `WindowTooTight` (owner decision 3). */
    moreTime: boolean;
  }[];
  /** Placed Tasks that break a rule, derived on read over the stored Plan (ADR 0010). */
  conflicts: {
    key: TaskKey;
    kind: Conflict["kind"];
    dish: { id: string; name: string } | null;
    batch: { id: string; label: string } | null;
    steps: { id: string; text: string }[];
    /** null: Service itself. */
    use: { key: TaskKey | null; label: string };
    sentence: string;
  }[];
};

/**
 * The Plan as stored (ADR 0010, D9): placed Tasks from `task_placements`, ends and ≈ from the
 * Steps, and Unplaced Tasks derived on read by one scheduler run over the same rows. Step
 * progress and behind (measured at `now`) are derived on read too; the read never writes (#88 D8).
 */
export async function readPlan(
  tx: Tx,
  ownerId: string,
  serviceId: string,
  timeZone: string,
  now: Date,
): Promise<PlanRead> {
  const service = await findLiveService(tx, ownerId, serviceId);
  return planReadOf(await loadPlanRows(tx, ownerId, service), timeZone, now);
}

/** `readPlan` over rows already loaded: no I/O, so it can be called with rows built in memory. */
export function planReadOf(rows: LoadedRows, timeZone: string, now: Date): PlanRead {
  const { model, tasks, scale } = toPlanningModel(rows, timeZone);
  const names = new Map(rows.dishes.map((d) => [d.dishId, d.recipe.name]));
  const recipes = [...rows.dishes.map((d) => d.recipe), ...rows.subRecipes.values()];
  const stepText = new Map(
    recipes.flatMap((r) => r.steps.map((s) => [s.id, stepPlainText(s)] as const)),
  );
  const stored = new Map(rows.batches.map((b) => [b.subRecipeId, b.batchId]));
  const batches = scale.batches.flatMap((b) =>
    stored.has(b.subRecipeId) ? [toBatchRead(b, stored.get(b.subRecipeId)!)] : [],
  );
  const labels = new Map(batches.map((b) => [b.id!, b.label]));
  const describe = (task: TaskInfo) => ({
    dish: task.dishId === null ? null : { id: task.dishId, name: names.get(task.dishId)! },
    batch: task.batchId === null ? null : { id: task.batchId, label: labels.get(task.batchId)! },
    steps: task.stepIds.map((id) => ({ id, text: stepText.get(id) ?? "" })),
  });
  const clock = (minute: number) => {
    const p = localParts(minute, timeZone);
    return { date: p.date, time: formatMinuteOfDay(p.minuteOfDay) };
  };

  // "Duck breast with beurre blanc · Sear the duck", as the Plan screen's line.
  const lineOf = (key: TaskKey) => {
    const d = describe(tasks.get(key)!);
    return `${d.batch?.label ?? d.dish?.name} · ${d.steps.map((s) => s.text).join(", ")}`;
  };
  const behind = behindTasks({
    placements: rows.previous,
    tasks,
    links: model.links,
    states: rows.progress,
    now: now.getTime() / 60_000,
  });
  const placed: (PlanTask & { at: number; date: LocalDate })[] = [];
  for (const p of rows.previous) {
    const task = tasks.get(p.key);
    if (!task) continue;
    const start = clock(p.start);
    const end = clock(p.start + task.activeMinutes + task.passiveMinutes);
    const described = describe(task);
    const steps = described.steps.map((step) => {
      const state = rows.progress.get(stepKey(task.owner, step.id));
      const doneAt =
        state?.done && state.doneAt
          ? clock(Math.floor(state.doneAt.getTime() / 60_000)).time
          : null;
      return { ...step, done: state?.done ?? false, doneAt };
    });
    const late = behind.get(p.key);
    const due = late ? clock(late.dueAt) : null;
    placed.push({
      key: p.key,
      owner: task.owner,
      ...described,
      steps,
      done: steps.every((step) => step.done),
      behind: late
        ? {
            dueAt: due!.time,
            dueDate: due!.date,
            holdsUp: late.holdsUp.map((key) => ({ key, label: lineOf(key) })),
          }
        : null,
      start: start.time,
      startMinute: p.start,
      end: end.time,
      endDate: end.date,
      activeMinutes: task.activeMinutes,
      passiveMinutes: task.passiveMinutes,
      approximate: task.approximate,
      pinned: p.pinned,
      at: p.start,
      date: start.date,
    });
  }
  placed.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  const days: PlanRead["days"] = [];
  for (const { at: _at, date, ...task } of placed) {
    if (days.at(-1)?.date !== date) days.push({ date, tasks: [] });
    days.at(-1)!.tasks.push(task);
  }

  const labelOf = (key: TaskKey) => {
    const task = tasks.get(key);
    return task ? (stepText.get(task.stepIds[0]) ?? key) : key;
  };
  // "Strain the stock (Chicken stock ×1.5)", "Blend and season (Velouté)".
  const batchNames = new Map(
    batches.map((b) => [b.id!, `${b.subRecipe.name} ${formatFactor(b.factor)}`]),
  );
  const taskLabel = (key: TaskKey) => {
    const task = tasks.get(key);
    if (!task) return key;
    const owner = task.batchId !== null ? batchNames.get(task.batchId) : names.get(task.dishId!);
    return `${labelOf(key)} (${owner})`;
  };
  const conflicts = conflictsOf(
    model,
    rows.previous.filter((p) => tasks.has(p.key)),
  ).map((c) => {
    // An Outrun Task is held up by the late Task, its `use` here.
    const use = c.kind === "Outrun" ? c.by : c.use;
    return {
      key: c.key,
      kind: c.kind,
      ...describe(tasks.get(c.key)!),
      use: { key: use, label: use === null ? "Service" : taskLabel(use) },
      sentence: describeConflict(c, taskLabel, timeZone),
    };
  });
  // The top-level Dishes a Batch feeds, through parent Batches, by its sub-recipe.
  const parentsOf = new Map(scale.batches.map((b) => [b.subRecipeId, b.parents]));
  const subRecipeOf = new Map(rows.batches.map((b) => [b.batchId, b.subRecipeId]));
  const fedDishes = (subRecipeId: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    if (seen.has(subRecipeId)) return out;
    seen.add(subRecipeId);
    for (const p of parentsOf.get(subRecipeId) ?? []) {
      if (p.kind === "dish") out.add(p.id);
      else for (const id of fedDishes(p.id, seen)) out.add(id);
    }
    return out;
  };
  const dishesOf = (task: TaskInfo) => {
    const ids =
      task.dishId !== null ? new Set([task.dishId]) : fedDishes(subRecipeOf.get(task.batchId!)!);
    return rows.dishes
      .filter((d) => ids.has(d.dishId))
      .map((d) => ({ id: d.dishId, name: d.recipe.name }));
  };
  const storedKeys = new Set(rows.previous.map((p) => p.key));
  const unplaced = schedule(model)
    .unplaced.filter((u) => !storedKeys.has(u.key))
    .map((u) => {
      const task = tasks.get(u.key)!;
      const pin = u.reason.kind === "BlockedByPin" ? tasks.get(u.reason.pin) : undefined;
      return {
        key: u.key,
        ...describe(task),
        kind: u.reason.kind,
        sentence: describeUnplaced(u.reason, task, timeZone, labelOf),
        blockingPin: pin
          ? { owner: pin.owner, firstStepId: pin.stepIds[0], label: taskLabel(pin.key) }
          : null,
        dishes: dishesOf(task),
        moreTime: u.reason.kind !== "WindowTooTight",
      };
    });

  return {
    service: {
      id: rows.service.id,
      menuId: rows.service.menuId,
      date: rows.service.date,
      time: formatMinuteOfDay(rows.service.time ?? rows.defaultServiceTime),
      timeIsDefault: rows.service.timeIsDefault,
    },
    timeZone,
    model: {
      ...model,
      previous: [...model.previous].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    },
    asOf: formatInstant(now, timeZone),
    approximate: placed.some((t) => t.approximate),
    days,
    batches,
    unplaced,
    conflicts,
  };
}
