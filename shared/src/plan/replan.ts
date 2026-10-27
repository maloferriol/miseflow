import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { NotFoundError, type MutatorContext, type Tx } from "../mutators/define.ts";
import { stepPlainText } from "../recipe/planning.ts";
import { conflictsOf, schedule } from "../scheduler/schedule.ts";
import {
  taskKey,
  type Conflict,
  type PlanningModel,
  type PreviousPlacement,
  type TaskKey,
  type UnplacedReason,
} from "../scheduler/types.ts";
import {
  availabilityOverrides,
  availabilityWeekly,
  cooks,
  courses,
  dishes,
  kitchenSettings,
  menus,
  services,
  stepEvents,
  taskPlacements,
} from "../schema.ts";
import { formatFactor, toBatchRead, type BatchRead } from "./batches.ts";
import {
  loadBatchRows,
  loadScaleRows,
  recipeAndAncestors,
  reconcileBatches,
} from "./batch-rows.ts";
import { diffPlacements, placementId, type StoredPlacement } from "./diff.ts";
import { deriveScale, type Hours, type PlanRows, type TaskInfo, toPlanningModel } from "./model.ts";
import { behindTasks } from "./behind.ts";
import { stepKey, stepStates } from "./progress.ts";
import { describeConflict, describeUnplaced } from "./reasons.ts";
import {
  formatInstant,
  formatMinuteOfDay,
  fromTimeColumn,
  type LocalDate,
  localParts,
} from "./time.ts";

// Re-plan against the database: read a Service's rows, run the pure scheduler, write the diff.

/**
 * The implicit Cook's id: the owner's id (D1), so one row per owner is guaranteed by the primary
 * key and the browser can compute it too. One atomic insert; an existing row is left untouched.
 */
export async function ensureCook(tx: Tx, ownerId: string): Promise<string> {
  await tx
    .insert(cooks)
    .values({ id: ownerId, ownerId, name: "Me" })
    .onConflictDoNothing({ target: cooks.id });
  return ownerId;
}

/** The implicit Cook, row-locked, so Availability saves of one owner run one after another (D10). */
export async function lockCook(tx: Tx, ownerId: string): Promise<string> {
  const cookId = await ensureCook(tx, ownerId);
  await tx
    .select({ id: cooks.id })
    .from(cooks)
    .where(and(eq(cooks.id, cookId), eq(cooks.ownerId, ownerId)))
    .for("no key update");
  return cookId;
}

export type Availability = {
  weekly: ({ id: string; weekday: number } & Hours)[];
  overrides: { id: string; date: LocalDate; hours: Hours | null }[];
};

/** The implicit Cook's live weekly hours and overrides (from `overridesFrom` on, when given), in order. */
export async function loadAvailability(
  tx: Tx,
  ownerId: string,
  overridesFrom?: LocalDate,
): Promise<Availability> {
  const weekly = await tx
    .select({
      id: availabilityWeekly.id,
      weekday: availabilityWeekly.weekday,
      startTime: availabilityWeekly.startTime,
      endTime: availabilityWeekly.endTime,
    })
    .from(availabilityWeekly)
    .where(
      and(
        eq(availabilityWeekly.cookId, ownerId),
        eq(availabilityWeekly.ownerId, ownerId),
        isNull(availabilityWeekly.deletedAt),
      ),
    )
    .orderBy(
      asc(availabilityWeekly.weekday),
      asc(availabilityWeekly.startTime),
      asc(availabilityWeekly.id),
    );
  const overrides = await tx
    .select({
      id: availabilityOverrides.id,
      date: availabilityOverrides.date,
      startTime: availabilityOverrides.startTime,
      endTime: availabilityOverrides.endTime,
    })
    .from(availabilityOverrides)
    .where(
      and(
        eq(availabilityOverrides.cookId, ownerId),
        eq(availabilityOverrides.ownerId, ownerId),
        isNull(availabilityOverrides.deletedAt),
        ...(overridesFrom ? [gte(availabilityOverrides.date, overridesFrom)] : []),
      ),
    )
    .orderBy(asc(availabilityOverrides.date), asc(availabilityOverrides.id));
  return {
    weekly: weekly.map((w) => ({
      id: w.id,
      weekday: w.weekday,
      start: fromTimeColumn(w.startTime),
      end: fromTimeColumn(w.endTime),
    })),
    overrides: overrides.map((o) => ({
      id: o.id,
      date: o.date,
      hours:
        o.startTime === null || o.endTime === null
          ? null
          : { start: fromTimeColumn(o.startTime), end: fromTimeColumn(o.endTime) },
    })),
  };
}

/** With no setting, the default Service time is 19:00 (D8, spec §3's example). */
export const BUILT_IN_SERVICE_TIME = 19 * 60;

/** The kitchen's default Service time, and whether it is the built-in one. */
export async function loadDefaultServiceTime(
  tx: Tx,
  ownerId: string,
): Promise<{ minuteOfDay: number; builtIn: boolean }> {
  const [row] = await tx
    .select({ time: kitchenSettings.defaultServiceTime })
    .from(kitchenSettings)
    .where(
      and(
        eq(kitchenSettings.ownerId, ownerId),
        isNull(kitchenSettings.deletedAt),
        isNotNull(kitchenSettings.defaultServiceTime),
      ),
    )
    .orderBy(asc(kitchenSettings.id))
    .limit(1);
  return row?.time
    ? { minuteOfDay: fromTimeColumn(row.time), builtIn: false }
    : { minuteOfDay: BUILT_IN_SERVICE_TIME, builtIn: true };
}

type ServiceRow = { id: string; menuId: string; date: LocalDate; time: string | null };

// The caller's live Service on a live Menu, row-locked when asked (D6); anything else is missing.
// FOR NO KEY UPDATE: rows that reference the Service (Step events, placements, Batches) take
// FOR KEY SHARE on it when inserted, which FOR UPDATE would wait on (#88 owner decision 1).
async function findService(
  tx: Tx,
  ownerId: string,
  serviceId: string,
  { lock = false } = {},
): Promise<ServiceRow> {
  const query = tx
    .select({ id: services.id, menuId: services.menuId, date: services.date, time: services.time })
    .from(services)
    .where(
      and(eq(services.id, serviceId), eq(services.ownerId, ownerId), isNull(services.deletedAt)),
    );
  const [service] = lock ? await query.for("no key update") : await query;
  if (!service) throw new NotFoundError("Service");
  const [menu] = await tx
    .select({ id: menus.id })
    .from(menus)
    .where(and(eq(menus.id, service.menuId), eq(menus.ownerId, ownerId), isNull(menus.deletedAt)));
  if (!menu) throw new NotFoundError("Service");
  return service;
}

/** The caller's live Service on a live Menu, read without a row lock; anything else is missing. */
export function findLiveService(tx: Tx, ownerId: string, serviceId: string): Promise<ServiceRow> {
  return findService(tx, ownerId, serviceId);
}

/** The caller's live Service, row-locked (D6), for a mutator that writes before re-planning it. */
export function lockService(tx: Tx, ownerId: string, serviceId: string): Promise<ServiceRow> {
  return findService(tx, ownerId, serviceId, { lock: true });
}

type LoadedRows = PlanRows & {
  service: PlanRows["service"] & { menuId: string; timeIsDefault: boolean };
};

/** Everything one Service's re-plan reads. Reads only: the implicit Cook's id is the owner's (D1). */
export async function loadPlanRows(
  tx: Tx,
  ownerId: string,
  service: ServiceRow,
): Promise<LoadedRows> {
  const cookId = ownerId;
  const defaultTime = await loadDefaultServiceTime(tx, ownerId);
  const availability = await loadAvailability(tx, ownerId);
  const scale = await loadScaleRows(tx, ownerId, service.menuId);
  const stored = await loadStored(tx, service.id);
  return {
    service: {
      id: service.id,
      menuId: service.menuId,
      date: service.date,
      time: service.time === null ? null : fromTimeColumn(service.time),
      timeIsDefault: service.time === null,
    },
    defaultServiceTime: defaultTime.minuteOfDay,
    cookId,
    weekly: availability.weekly,
    overrides: availability.overrides,
    ...scale,
    batches: await loadBatchRows(tx, service.id),
    previous: stored
      .filter((p) => p.live)
      .map(({ key, start, cookId, pinned }) => ({ key, start, cookId, pinned })),
    progress: await loadProgress(tx, service.id),
  };
}

// Every Step event of the Service, reduced to each Step's state. Events of a removed Step, Dish
// or Batch match no Task and are ignored downstream.
async function loadProgress(tx: Tx, serviceId: string) {
  const events = await tx
    .select({
      id: stepEvents.id,
      dishId: stepEvents.dishId,
      batchId: stepEvents.batchId,
      stepId: stepEvents.stepId,
      kind: stepEvents.kind,
      at: stepEvents.at,
    })
    .from(stepEvents)
    .where(eq(stepEvents.serviceId, serviceId));
  return stepStates(
    events.map((e) => ({
      id: e.id,
      owner:
        e.dishId !== null
          ? { kind: "dish" as const, dishId: e.dishId }
          : { kind: "batch" as const, batchId: e.batchId! },
      stepId: e.stepId,
      kind: e.kind,
      at: e.at,
    })),
  );
}

// Every placement row of the Service, soft-deleted ones too (a Task's row is unique across them).
async function loadStored(tx: Tx, serviceId: string): Promise<StoredPlacement[]> {
  const rows = await tx
    .select({
      id: taskPlacements.id,
      dishId: taskPlacements.dishId,
      batchId: taskPlacements.batchId,
      firstStepId: taskPlacements.firstStepId,
      start: taskPlacements.startMinute,
      cookId: taskPlacements.cookId,
      pinned: taskPlacements.pinned,
      deletedAt: taskPlacements.deletedAt,
    })
    .from(taskPlacements)
    .where(eq(taskPlacements.serviceId, serviceId))
    .orderBy(asc(taskPlacements.id));
  return rows.map((r) => ({
    id: r.id,
    key: taskKey(
      r.dishId !== null
        ? { kind: "dish", dishId: r.dishId }
        : { kind: "batch", batchId: r.batchId! },
      r.firstStepId,
    ),
    start: r.start,
    cookId: r.cookId ?? "",
    pinned: r.pinned,
    live: r.deletedAt === null,
  }));
}

/**
 * Re-plans one Service and writes only what moved (D5): locks the Service (D6), reads its rows,
 * makes its Batch rows match the sub-recipes it uses (#87 D7), runs the scheduler with the stored
 * Plan as the previous one, and writes the diff.
 */
export function replan(tx: Tx, ctx: MutatorContext, serviceId: string) {
  return replanWith(tx, ctx, serviceId, {});
}

/**
 * `replan` with one Task released (#90 AC2, plan addendum 2): its previous start is dropped, so
 * it is placed afresh; every other Task keeps its previous start, as in a normal re-plan.
 */
export function replanReleasing(tx: Tx, ctx: MutatorContext, serviceId: string, key: TaskKey) {
  return replanWith(tx, ctx, serviceId, { keep: (p) => p.key !== key });
}

/**
 * "Re-plan from scratch" (#90 AC4, owner decision 5): every Task is placed as if there were no
 * previous Plan, except pinned Tasks and Tasks with a ticked Step, which keep their starts.
 */
export function replanFromScratchOf(tx: Tx, ctx: MutatorContext, serviceId: string) {
  return replanWith(tx, ctx, serviceId, {
    keep: (p, progressed) => p.pinned || progressed.has(p.key),
  });
}

// `keep`: which stored placements go to the scheduler as `previous` (all, by default); it is
// given the Tasks with a ticked Step. The diff still runs against every stored row, so a dropped
// Task's row is updated, not inserted again.
async function replanWith(
  tx: Tx,
  ctx: MutatorContext,
  serviceId: string,
  opts: { keep?: (p: PreviousPlacement, progressed: Set<TaskKey>) => boolean },
) {
  const service = await findService(tx, ctx.ownerId, serviceId, { lock: true });
  // Placements reference the Cook row.
  await ensureCook(tx, ctx.ownerId);
  const rows = await loadPlanRows(tx, ctx.ownerId, service);
  const needed = deriveScale(rows).batches.map((b) => b.subRecipeId);
  const reconciled = await reconcileBatches(tx, ctx.ownerId, serviceId, needed);
  if (reconciled.inserted + reconciled.revived + reconciled.removed)
    rows.batches = await loadBatchRows(tx, serviceId);
  const { model, tasks } = toPlanningModel(rows, ctx.timeZone);
  if (opts.keep) {
    // The Tasks are known only once the rows are modelled; `previous` doesn't change them.
    const progressed = new Set(
      [...tasks.values()]
        .filter((t) => t.stepIds.some((id) => rows.progress.get(stepKey(t.owner, id))?.done))
        .map((t) => t.key),
    );
    model.previous = model.previous.filter((p) => opts.keep!(p, progressed));
  }
  const plan = schedule(model);
  const diff = diffPlacements(await loadStored(tx, serviceId), plan.placements);

  if (diff.insert.length) {
    const values = [];
    for (const p of diff.insert) {
      const task = tasks.get(p.key)!;
      values.push({
        id: await placementId(serviceId, p.key),
        ownerId: ctx.ownerId,
        serviceId,
        dishId: task.dishId,
        batchId: task.batchId,
        firstStepId: task.stepIds[0]!,
        startMinute: p.start,
        cookId: p.cookId,
        pinned: p.pinned,
      });
    }
    await tx.insert(taskPlacements).values(values);
  }
  for (const u of diff.update) {
    await tx
      .update(taskPlacements)
      .set({
        startMinute: u.start,
        cookId: u.cookId,
        updatedAt: sql`now()`,
        ...(u.revive ? { deletedAt: null, pinned: false } : {}),
      })
      .where(eq(taskPlacements.id, u.id));
  }
  if (diff.remove.length) {
    await tx
      .update(taskPlacements)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(inArray(taskPlacements.id, diff.remove));
  }
  return { inserted: diff.insert.length, updated: diff.update.length, removed: diff.remove.length };
}

export type ReplanScope =
  | { recipeId: string }
  | { menuId: string }
  | { serviceId: string }
  | { allServices: true; onlyDefaultTime?: boolean };

/** The caller's live Services (on live Menus) in scope, in id order. */
export async function servicesInScope(
  tx: Tx,
  ownerId: string,
  scope: ReplanScope,
): Promise<string[]> {
  const live = and(
    eq(services.ownerId, ownerId),
    isNull(services.deletedAt),
    isNull(menus.deletedAt),
  );
  const base = tx
    .selectDistinct({ id: services.id })
    .from(services)
    .innerJoin(menus, eq(menus.id, services.menuId));
  let rows: { id: string }[];
  if ("recipeId" in scope) {
    // A Service uses a Recipe through its Dishes, or through sub-recipes they reach (#87).
    const used = await recipeAndAncestors(tx, ownerId, scope.recipeId);
    rows = await base
      .innerJoin(courses, eq(courses.menuId, services.menuId))
      .innerJoin(dishes, eq(dishes.courseId, courses.id))
      .where(
        and(
          live,
          inArray(dishes.recipeId, used),
          isNull(dishes.deletedAt),
          isNull(courses.deletedAt),
        ),
      )
      .orderBy(asc(services.id));
  } else if ("menuId" in scope) {
    rows = await base.where(and(live, eq(services.menuId, scope.menuId))).orderBy(asc(services.id));
  } else if ("serviceId" in scope) {
    rows = await base.where(and(live, eq(services.id, scope.serviceId))).orderBy(asc(services.id));
  } else {
    rows = await base
      .where(and(live, ...(scope.onlyDefaultTime ? [isNull(services.time)] : [])))
      .orderBy(asc(services.id));
  }
  return rows.map((r) => r.id);
}

/** The live Services in scope, row-locked in id order (D6), for a mutator that writes before re-planning them. */
export async function lockServices(tx: Tx, ownerId: string, scope: ReplanScope): Promise<string[]> {
  const ids = await servicesInScope(tx, ownerId, scope);
  if (ids.length)
    await tx
      .select({ id: services.id })
      .from(services)
      .where(inArray(services.id, ids))
      .orderBy(asc(services.id))
      .for("no key update");
  return ids;
}

/**
 * Re-plans every live Service in scope, past ones included (D7), each locked in id order (D6).
 * Called at the end of each mutator that changes a Task, inside its transaction.
 */
export async function replanAffected(tx: Tx, ctx: MutatorContext, scope: ReplanScope) {
  for (const id of await servicesInScope(tx, ctx.ownerId, scope)) await replan(tx, ctx, id);
}

export type PlanTask = {
  key: TaskKey;
  /** What `tickStep` takes. */
  owner: { kind: "dish"; dishId: string } | { kind: "batch"; batchId: string };
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
  const service = await findService(tx, ownerId, serviceId);
  const rows = await loadPlanRows(tx, ownerId, service);
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
    return task ? (stepText.get(task.stepIds[0]!) ?? key) : key;
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
          ? { owner: pin.owner, firstStepId: pin.stepIds[0]!, label: taskLabel(pin.key) }
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
