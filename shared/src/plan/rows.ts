import { and, asc, eq, isNull } from "drizzle-orm";
import { loadAvailability, loadDefaultServiceTime } from "../kitchen/availability.ts";
import { NotFoundError, type Tx } from "../mutators/define.ts";
import { taskKey } from "../scheduler/types.ts";
import { menus, services, stepEvents, taskPlacements } from "../schema.ts";
import { loadBatchRows, loadScaleRows } from "./batch-rows.ts";
import type { StoredPlacement } from "./diff.ts";
import type { PlanRows } from "./model.ts";
import { stepStates } from "./progress.ts";
import { fromTimeColumn, type LocalDate } from "./time.ts";

// A Service and the rows its Plan is made from, read from the database.

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

export type LoadedRows = PlanRows & {
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
export async function loadStored(tx: Tx, serviceId: string): Promise<StoredPlacement[]> {
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
