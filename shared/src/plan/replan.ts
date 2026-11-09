import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ensureCook } from "../kitchen/availability.ts";
import type { MutatorContext, Tx } from "../mutators/define.ts";
import { schedule } from "../scheduler/schedule.ts";
import type { PreviousPlacement, TaskKey } from "../scheduler/types.ts";
import { cooks, courses, dishes, menus, services, taskPlacements } from "../schema.ts";
import { loadBatchRows, recipeAndAncestors, reconcileBatches } from "./batch-rows.ts";
import { diffPlacements, placementId } from "./diff.ts";
import { deriveScale, toPlanningModel } from "./model.ts";
import { stepKey } from "./progress.ts";
import { loadPlanRows, loadStored, lockService } from "./rows.ts";

// Re-plan against the database: read a Service's rows, run the pure scheduler, write the diff.

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
  const service = await lockService(tx, ctx.ownerId, serviceId);
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
        firstStepId: task.stepIds[0],
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
