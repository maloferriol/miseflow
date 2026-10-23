import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { NotFoundError, type MutatorContext, type Tx } from "../mutators/define.ts";
import { stepPlainText } from "../recipe/planning.ts";
import { loadRecipeSnapshot, type RecipeSnapshot } from "../recipe/snapshot.ts";
import { schedule } from "../scheduler/schedule.ts";
import { taskKey, type TaskKey, type UnplacedReason } from "../scheduler/types.ts";
import {
  availabilityOverrides,
  availabilityWeekly,
  cooks,
  courses,
  dishes,
  kitchenSettings,
  menus,
  recipes,
  services,
  taskPlacements,
} from "../schema.ts";
import { diffPlacements, placementId, type StoredPlacement } from "./diff.ts";
import { type Hours, type PlanRows, type TaskInfo, toPlanningModel } from "./model.ts";
import { describeUnplaced } from "./reasons.ts";
import { formatMinuteOfDay, fromTimeColumn, type LocalDate, localParts } from "./time.ts";

// Re-plan against the database: read a Service's rows, run the pure scheduler, write the diff.

/**
 * The implicit Cook's id: the owner's id (D1), so one row per owner is guaranteed by the primary
 * key and the browser can compute it too. One atomic insert; an existing row is left untouched.
 */
export async function ensureCook(tx: Tx, ownerId: string): Promise<string> {
  await tx.insert(cooks).values({ id: ownerId, ownerId, name: "Me" }).onConflictDoNothing({ target: cooks.id });
  return ownerId;
}

/** The implicit Cook, row-locked, so Availability saves of one owner run one after another (D10). */
export async function lockCook(tx: Tx, ownerId: string): Promise<string> {
  const cookId = await ensureCook(tx, ownerId);
  await tx.select({ id: cooks.id }).from(cooks).where(and(eq(cooks.id, cookId), eq(cooks.ownerId, ownerId))).for("update");
  return cookId;
}

export type Availability = {
  weekly: ({ id: string; weekday: number } & Hours)[];
  overrides: { id: string; date: LocalDate; hours: Hours | null }[];
};

/** The implicit Cook's live weekly hours and overrides (from `overridesFrom` on, when given), in order. */
export async function loadAvailability(tx: Tx, ownerId: string, overridesFrom?: LocalDate): Promise<Availability> {
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
    .orderBy(asc(availabilityWeekly.weekday), asc(availabilityWeekly.startTime), asc(availabilityWeekly.id));
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
export async function loadDefaultServiceTime(tx: Tx, ownerId: string): Promise<{ minuteOfDay: number; builtIn: boolean }> {
  const [row] = await tx
    .select({ time: kitchenSettings.defaultServiceTime })
    .from(kitchenSettings)
    .where(and(eq(kitchenSettings.ownerId, ownerId), isNull(kitchenSettings.deletedAt), isNotNull(kitchenSettings.defaultServiceTime)))
    .orderBy(asc(kitchenSettings.id))
    .limit(1);
  return row?.time ? { minuteOfDay: fromTimeColumn(row.time), builtIn: false } : { minuteOfDay: BUILT_IN_SERVICE_TIME, builtIn: true };
}

type ServiceRow = { id: string; menuId: string; date: LocalDate; time: string | null };

// The caller's live Service on a live Menu, row-locked when asked (D6); anything else is missing.
async function findService(tx: Tx, ownerId: string, serviceId: string, { lock = false } = {}): Promise<ServiceRow> {
  const query = tx
    .select({ id: services.id, menuId: services.menuId, date: services.date, time: services.time })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.ownerId, ownerId), isNull(services.deletedAt)));
  const [service] = lock ? await query.for("update") : await query;
  if (!service) throw new NotFoundError("Service");
  const [menu] = await tx
    .select({ id: menus.id })
    .from(menus)
    .where(and(eq(menus.id, service.menuId), eq(menus.ownerId, ownerId), isNull(menus.deletedAt)));
  if (!menu) throw new NotFoundError("Service");
  return service;
}

type LoadedRows = PlanRows & { service: PlanRows["service"] & { menuId: string; timeIsDefault: boolean }; snapshots: Map<string, RecipeSnapshot> };

/** Everything one Service's re-plan reads. Reads only: the implicit Cook's id is the owner's (D1). */
export async function loadPlanRows(tx: Tx, ownerId: string, service: ServiceRow): Promise<LoadedRows> {
  const cookId = ownerId;
  const defaultTime = await loadDefaultServiceTime(tx, ownerId);
  const availability = await loadAvailability(tx, ownerId);
  const dishRows = await tx
    .select({ dishId: dishes.id, recipeId: dishes.recipeId })
    .from(dishes)
    .innerJoin(courses, eq(courses.id, dishes.courseId))
    .innerJoin(recipes, eq(recipes.id, dishes.recipeId))
    .where(
      and(
        eq(courses.menuId, service.menuId),
        eq(dishes.ownerId, ownerId),
        isNull(dishes.deletedAt),
        isNull(courses.deletedAt),
        eq(recipes.ownerId, ownerId),
        isNull(recipes.deletedAt),
      ),
    )
    .orderBy(asc(sql`${courses.position} collate "C"`), asc(sql`${dishes.position} collate "C"`), asc(dishes.id));
  const snapshots = new Map<string, RecipeSnapshot>();
  for (const { recipeId } of dishRows)
    if (!snapshots.has(recipeId)) snapshots.set(recipeId, await loadRecipeSnapshot(tx, ownerId, recipeId));
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
    dishes: dishRows.map((d) => ({ dishId: d.dishId, recipe: snapshots.get(d.recipeId)! })),
    previous: stored.filter((p) => p.live).map(({ key, start, cookId, pinned }) => ({ key, start, cookId, pinned })),
    snapshots,
  };
}

// Every placement row of the Service, soft-deleted ones too (a Task's row is unique across them).
async function loadStored(tx: Tx, serviceId: string): Promise<StoredPlacement[]> {
  const rows = await tx
    .select({
      id: taskPlacements.id,
      dishId: taskPlacements.dishId,
      firstStepId: taskPlacements.firstStepId,
      start: taskPlacements.startMinute,
      cookId: taskPlacements.cookId,
      pinned: taskPlacements.pinned,
      deletedAt: taskPlacements.deletedAt,
    })
    .from(taskPlacements)
    .where(and(eq(taskPlacements.serviceId, serviceId), isNotNull(taskPlacements.dishId)))
    .orderBy(asc(taskPlacements.id));
  return rows.map((r) => ({
    id: r.id,
    key: taskKey({ kind: "dish", dishId: r.dishId! }, r.firstStepId),
    start: r.start,
    cookId: r.cookId ?? "",
    pinned: r.pinned,
    live: r.deletedAt === null,
  }));
}

/**
 * Re-plans one Service and writes only what moved (D5): locks the Service (D6), reads its rows,
 * runs the scheduler with the stored Plan as the previous one, and writes the diff.
 */
export async function replan(tx: Tx, ctx: MutatorContext, serviceId: string) {
  const service = await findService(tx, ctx.ownerId, serviceId, { lock: true });
  // Placements reference the Cook row.
  await ensureCook(tx, ctx.ownerId);
  const rows = await loadPlanRows(tx, ctx.ownerId, service);
  const { model, tasks } = toPlanningModel(rows, ctx.timeZone);
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
      .set({ startMinute: u.start, cookId: u.cookId, updatedAt: sql`now()`, ...(u.revive ? { deletedAt: null, pinned: false } : {}) })
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
export async function servicesInScope(tx: Tx, ownerId: string, scope: ReplanScope): Promise<string[]> {
  const live = and(eq(services.ownerId, ownerId), isNull(services.deletedAt), isNull(menus.deletedAt));
  const base = tx.selectDistinct({ id: services.id }).from(services).innerJoin(menus, eq(menus.id, services.menuId));
  let rows: { id: string }[];
  if ("recipeId" in scope) {
    rows = await base
      .innerJoin(courses, eq(courses.menuId, services.menuId))
      .innerJoin(dishes, eq(dishes.courseId, courses.id))
      .where(and(live, eq(dishes.recipeId, scope.recipeId), isNull(dishes.deletedAt), isNull(courses.deletedAt)))
      .orderBy(asc(services.id));
  } else if ("menuId" in scope) {
    rows = await base.where(and(live, eq(services.menuId, scope.menuId))).orderBy(asc(services.id));
  } else if ("serviceId" in scope) {
    rows = await base.where(and(live, eq(services.id, scope.serviceId))).orderBy(asc(services.id));
  } else {
    rows = await base.where(and(live, ...(scope.onlyDefaultTime ? [isNull(services.time)] : []))).orderBy(asc(services.id));
  }
  return rows.map((r) => r.id);
}

/** The live Services in scope, row-locked in id order (D6), for a mutator that writes before re-planning them. */
export async function lockServices(tx: Tx, ownerId: string, scope: ReplanScope): Promise<string[]> {
  const ids = await servicesInScope(tx, ownerId, scope);
  if (ids.length)
    await tx.select({ id: services.id }).from(services).where(inArray(services.id, ids)).orderBy(asc(services.id)).for("update");
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
  dish: { id: string; name: string };
  steps: { id: string; text: string }[];
  start: string;
  end: string;
  endDate: LocalDate;
  activeMinutes: number;
  passiveMinutes: number;
  approximate: boolean;
  pinned: boolean;
};

export type PlanRead = {
  service: { id: string; menuId: string; date: LocalDate; time: string; timeIsDefault: boolean };
  /** Any placed Task is approximate. */
  approximate: boolean;
  /** Days in the kitchen's zone, Tasks by start. */
  days: { date: LocalDate; tasks: PlanTask[] }[];
  unplaced: {
    key: TaskKey;
    dish: { id: string; name: string };
    steps: { id: string; text: string }[];
    kind: UnplacedReason["kind"];
    sentence: string;
  }[];
};

/**
 * The Plan as stored (ADR 0010, D9): placed Tasks from `task_placements`, ends and ≈ from the
 * Steps, and Unplaced Tasks derived on read by one scheduler run over the same rows.
 */
export async function readPlan(tx: Tx, ownerId: string, serviceId: string, timeZone: string): Promise<PlanRead> {
  const service = await findService(tx, ownerId, serviceId);
  const rows = await loadPlanRows(tx, ownerId, service);
  const { model, tasks } = toPlanningModel(rows, timeZone);
  const names = new Map(rows.dishes.map((d) => [d.dishId, d.recipe.name]));
  const stepText = new Map(rows.dishes.flatMap((d) => d.recipe.steps.map((s) => [s.id, stepPlainText(s)] as const)));
  const describe = (task: TaskInfo) => ({
    dish: { id: task.dishId, name: names.get(task.dishId)! },
    steps: task.stepIds.map((id) => ({ id, text: stepText.get(id) ?? "" })),
  });
  const clock = (minute: number) => {
    const p = localParts(minute, timeZone);
    return { date: p.date, time: formatMinuteOfDay(p.minuteOfDay) };
  };

  const placed: (PlanTask & { at: number; date: LocalDate })[] = [];
  for (const p of rows.previous) {
    const task = tasks.get(p.key);
    if (!task) continue;
    const start = clock(p.start);
    const end = clock(p.start + task.activeMinutes + task.passiveMinutes);
    placed.push({
      key: p.key,
      ...describe(task),
      start: start.time,
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
  const storedKeys = new Set(rows.previous.map((p) => p.key));
  const unplaced = schedule(model)
    .unplaced.filter((u) => !storedKeys.has(u.key))
    .map((u) => {
      const task = tasks.get(u.key)!;
      return { key: u.key, ...describe(task), kind: u.reason.kind, sentence: describeUnplaced(u.reason, task, timeZone, labelOf) };
    });

  return {
    service: {
      id: rows.service.id,
      menuId: rows.service.menuId,
      date: rows.service.date,
      time: formatMinuteOfDay(rows.service.time ?? rows.defaultServiceTime),
      timeIsDefault: rows.service.timeIsDefault,
    },
    approximate: placed.some((t) => t.approximate),
    days,
    unplaced,
  };
}
