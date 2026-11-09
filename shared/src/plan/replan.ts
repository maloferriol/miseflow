import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ensureCook } from "../kitchen/availability.ts";
import { type CallerContext, NotFoundError, type Tx } from "../mutators/define.ts";
import { schedule } from "../scheduler/schedule.ts";
import type { PreviousPlacement, TaskKey } from "../scheduler/types.ts";
import { cooks, courses, dishes, menus, services, taskPlacements } from "../schema.ts";
import { loadBatchRows, recipeAndAncestors, reconcileBatches } from "./batch-rows.ts";
import { diffPlacements, placementId } from "./diff.ts";
import { deriveScale, toPlanningModel } from "./model.ts";
import { stepKey } from "./progress.ts";
import { findLiveService, loadPlanRows, loadStored } from "./rows.ts";

// The Re-plan module (ADR 0013). A mutator registers what its write affects through
// `ctx.replan`; `applyMutation` then re-plans each affected Service once, at the end of the
// mutation's transaction: it reads the Service's rows, runs the pure scheduler, and writes the diff.
//
// Lock order (D6, #86): the changed Recipe or Dish row (the mutator's own lock), then Services in
// id order, then the Cook. Always FOR NO KEY UPDATE: rows that reference a Service or the Cook
// (Step events, placements, Batches, Availability) take FOR KEY SHARE on it when inserted, which
// FOR UPDATE would wait on (#88 owner decision 1, #113).
// Source: https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS

/** What a write affects. Each kind is turned into the caller's live Services on live Menus. */
export type ReplanScope =
  | { recipeId: string }
  | { menuId: string }
  /** One Service: if it isn't the caller's live Service, the mutation fails with NotFound. */
  | { serviceId: string }
  | { allServices: true; onlyDefaultTime?: boolean };

export type ReplanOptions = {
  /** Unpin (#90 AC2, plan addendum 2): this Task's previous start is dropped, so it is placed afresh. */
  release?: TaskKey;
  /**
   * "Re-plan from scratch" (#90 AC4, owner decision 5): every Task is placed as if there were no
   * previous Plan, except pinned Tasks and Tasks with a ticked Step, which keep their starts.
   */
  fromScratch?: boolean;
};

/** `ctx.replan`: how a mutator names the Services its write affects. It never re-plans itself. */
export type Replan = {
  /**
   * For a mutator that reads something that must not change before it writes: turns the scope
   * into Services now and locks them in id order, then the Cook when asked. They are re-planned
   * at the end, as with `after`. Returns the Service ids, in id order, and the Cook's id.
   */
  lock(
    scope: ReplanScope,
    options: { cook: true },
  ): Promise<{ serviceIds: string[]; cookId: string }>;
  lock(scope: ReplanScope, options?: { cook?: false }): Promise<{ serviceIds: string[] }>;
  /**
   * For a mutator that locks its own Recipe or Dish row first: records the scope, which is turned
   * into Services once the mutator has written (so a Dish it added counts), then locked.
   */
  after(scope: ReplanScope, options?: ReplanOptions): void;
};

// One Service's registrations, merged: from scratch wins over a normal re-plan; releases add up.
type Merged = { fromScratch: boolean; release: Set<TaskKey> };

/**
 * A fresh registry for one mutation. `replan` goes on the mutator's context; `finish` runs after
 * the mutator, in its transaction: it locks the Services not locked yet, in id order, re-plans
 * each registered Service once, in id order, and returns their ids.
 */
export function replanRegistry(tx: Tx, ctx: CallerContext) {
  const merged = new Map<string, Merged>();
  const locked = new Set<string>();
  const pending: { scope: ReplanScope; options: ReplanOptions }[] = [];
  const register = (ids: string[], options: ReplanOptions) => {
    for (const id of ids) {
      const m = merged.get(id) ?? { fromScratch: false, release: new Set<TaskKey>() };
      m.fromScratch ||= options.fromScratch === true;
      if (options.release) m.release.add(options.release);
      merged.set(id, m);
    }
  };

  async function lock(scope: ReplanScope, options: { cook?: boolean } = {}) {
    const serviceIds = await servicesInScope(tx, ctx.ownerId, scope);
    await lockServices(tx, serviceIds);
    for (const id of serviceIds) locked.add(id);
    register(serviceIds, {});
    if (!options.cook) return { serviceIds };
    return { serviceIds, cookId: await lockCook(tx, ctx.ownerId) };
  }

  const replan = {
    lock,
    after(scope: ReplanScope, options: ReplanOptions = {}) {
      pending.push({ scope, options });
    },
  } as Replan;

  async function finish(): Promise<string[]> {
    // Read-only lookups, so they can run together; each is registered in the order it was asked for.
    const found = await Promise.all(
      pending.map(({ scope }) => servicesInScope(tx, ctx.ownerId, scope)),
    );
    pending.forEach(({ options }, i) => register(found[i], options));
    // Code-point order, as Postgres orders uuids, so the re-plans run in the lock order (D6).
    const ids = [...merged.keys()].sort((a, b) => Number(a > b) - Number(a < b));
    await lockServices(
      tx,
      ids.filter((id) => !locked.has(id)),
    );
    // One at a time, in id order: each re-plan takes row locks of its own (Batches, placements).
    await ids.reduce(
      (previous, id) => previous.then(() => replanOne(tx, ctx, id, keepOf(merged.get(id)!))),
      Promise.resolve(),
    );
    return ids;
  }

  return { replan, finish };
}

// Which stored placements a re-plan gives the scheduler as `previous` (all, by default); it is
// given the Tasks with a ticked Step.
type Keep = (p: PreviousPlacement, progressed: Set<TaskKey>) => boolean;

function keepOf({ fromScratch, release }: Merged): Keep | undefined {
  if (!fromScratch && !release.size) return undefined;
  return (p, progressed) =>
    !release.has(p.key) && (!fromScratch || p.pinned || progressed.has(p.key));
}

// The implicit Cook, row-locked, so Availability saves of one owner run one after another (D10).
async function lockCook(tx: Tx, ownerId: string): Promise<string> {
  const cookId = await ensureCook(tx, ownerId);
  await tx
    .select({ id: cooks.id })
    .from(cooks)
    .where(and(eq(cooks.id, cookId), eq(cooks.ownerId, ownerId)))
    .for("no key update");
  return cookId;
}

// Row-locks the Services in id order.
async function lockServices(tx: Tx, ids: string[]) {
  if (ids.length)
    await tx
      .select({ id: services.id })
      .from(services)
      .where(inArray(services.id, ids))
      .orderBy(asc(services.id))
      .for("no key update");
}

// Re-plans one Service, already locked, and writes only what moved (D5): reads its rows, makes its
// Batch rows match the sub-recipes it uses (#87 D7), runs the scheduler with the stored Plan as
// the previous one, and writes the diff. The diff runs against every stored row, so a Task whose
// previous start `keep` dropped has its row updated, not inserted again.
async function replanOne(tx: Tx, ctx: CallerContext, serviceId: string, keep: Keep | undefined) {
  const service = await findLiveService(tx, ctx.ownerId, serviceId);
  // Placements reference the Cook row.
  await ensureCook(tx, ctx.ownerId);
  const rows = await loadPlanRows(tx, ctx.ownerId, service);
  const needed = deriveScale(rows).batches.map((b) => b.subRecipeId);
  const reconciled = await reconcileBatches(tx, ctx.ownerId, serviceId, needed);
  if (reconciled.inserted + reconciled.revived + reconciled.removed)
    rows.batches = await loadBatchRows(tx, serviceId);
  const { model, tasks } = toPlanningModel(rows, ctx.timeZone);
  if (keep) {
    // The Tasks are known only once the rows are modelled; `previous` doesn't change them.
    const progressed = new Set(
      [...tasks.values()]
        .filter((t) => t.stepIds.some((id) => rows.progress.get(stepKey(t.owner, id))?.done))
        .map((t) => t.key),
    );
    model.previous = model.previous.filter((p) => keep(p, progressed));
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
}

// The caller's live Services (on live Menus) in scope, in id order (past ones included, D7).
async function servicesInScope(tx: Tx, ownerId: string, scope: ReplanScope): Promise<string[]> {
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
    if (!rows.length) throw new NotFoundError("Service");
  } else {
    rows = await base
      .where(and(live, ...(scope.onlyDefaultTime ? [isNull(services.time)] : [])))
      .orderBy(asc(services.id));
  }
  return rows.map((r) => r.id);
}
