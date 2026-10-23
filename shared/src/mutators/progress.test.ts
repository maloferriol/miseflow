import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, setWalkthroughAvailability } from "../../test/walkthrough.ts";
import { batchId } from "../plan/batch-rows.ts";
import { readPlan, type PlanRead } from "../plan/replan.ts";
import { dishes, stepEvents, taskPlacements } from "../schema.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");
const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";

async function run(tx: Tx, name: string, args: unknown, options: { owner?: string; now?: () => Date } = {}) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: options.owner ?? ownerId, timeZone, now: options.now ?? (() => FIXED_NOW) });
}

// The walkthrough (with the stock when asked) with its Service and Availability, inside the test's transaction.
async function walkthrough(tx: Tx, options: { stock?: boolean } = {}) {
  const s = crypto.randomUUID().slice(0, 8);
  const w = await buildWalkthrough((name, args) => run(tx, name, args), s, options);
  await setWalkthroughAvailability((name, args) => run(tx, name, args));
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
  return { w, s, serviceId };
}

// Each live placement's start minute, by the Step that keys its Task.
async function starts(tx: Tx, serviceId: string) {
  const rows = await tx
    .select({ stepId: taskPlacements.firstStepId, start: taskPlacements.startMinute })
    .from(taskPlacements)
    .where(and(eq(taskPlacements.serviceId, serviceId), isNull(taskPlacements.deletedAt)));
  return new Map(rows.map((r) => [r.stepId, r.start]));
}

const taskOf = (plan: PlanRead, stepId: string) => plan.days.flatMap((d) => d.tasks).find((t) => t.steps[0]!.id === stepId)!;

describe("Behind on the Plan read", () => {
  it("AC3: with the clock 5 minutes past D2's due time and nothing ticked, D2 is behind and holds up D3 and D4; 5 minutes before, it isn't", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await walkthrough(tx);
      const d2 = (await starts(tx, serviceId)).get(w.steps.D2)!;
      // D2 (Score and season) is 10 minutes of active time, so it's due 10 minutes after its start.
      const due = new Date((d2 + 10) * 60_000);
      const late = await readPlan(tx, ownerId, serviceId, timeZone, new Date(due.getTime() + 5 * 60_000));
      const duck = `Duck breast with beurre blanc ${s}`;
      expect(taskOf(late, w.steps.D2).behind).toEqual({
        dueAt: "17:30",
        dueDate: "2026-10-31",
        holdsUp: [
          { key: `dish:${w.dishes.duck}:${w.steps.D3}`, label: `${duck} · Sear the duck` },
          { key: `dish:${w.dishes.duck}:${w.steps.D4}`, label: `${duck} · Make the beurre blanc` },
        ],
      });
      expect(taskOf(late, w.steps.V3).behind).toBeNull();
      expect(late.asOf).toBe("Sat 31 Oct 17:35");

      const early = await readPlan(tx, ownerId, serviceId, timeZone, new Date(due.getTime() - 5 * 60_000));
      expect(taskOf(early, w.steps.D2).behind).toBeNull();
    });
  });
});

const events = (tx: Tx, serviceId: string, stepId: string) =>
  tx
    .select({ id: stepEvents.id, kind: stepEvents.kind, at: stepEvents.at })
    .from(stepEvents)
    .where(and(eq(stepEvents.serviceId, serviceId), eq(stepEvents.stepId, stepId)));

// Row actions on `table` so far in this transaction.
// Source: https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-STATS-VIEWS-TABLE
type Row = Record<string, unknown>;
const actions = async (tx: Tx, table: string) => {
  const [row] = (await tx.execute(sql`select n_tup_ins as ins, n_tup_upd as upd, n_tup_del as del
    from pg_stat_xact_user_tables where relname = ${table}`)) as unknown as Row[];
  return { ins: Number(row?.ins ?? 0), upd: Number(row?.upd ?? 0), del: Number(row?.del ?? 0) };
};

const dishOwner = (dishId: string) => ({ kind: "dish", dishId });
const tick = (serviceId: string, owner: unknown, stepId: string) => ({ eventId: crypto.randomUUID(), serviceId, owner, stepId });

// Runs a mutation that should be refused in a savepoint, so the checks after it can still run.
async function refused(tx: Tx, name: string, args: unknown, owner = ownerId) {
  let thrown: unknown;
  await tx.transaction(async (sp) => run(sp, name, args, { owner })).catch((e) => (thrown = e));
  expect(thrown).toBeInstanceOf(NotFoundError);
}

describe("tickStep and untickStep", () => {
  it("AC1: two ticks append two events; tick then untick reads not done; step_events is never updated or deleted", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx);
      const before = await actions(tx, "step_events");
      const owner = dishOwner(w.dishes.veloute);
      await run(tx, "tickStep", tick(serviceId, owner, w.steps.V1));
      await run(tx, "tickStep", tick(serviceId, owner, w.steps.V1));
      expect(await events(tx, serviceId, w.steps.V1)).toHaveLength(2);
      const done = taskOf(await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW), w.steps.V1);
      expect(done.steps[0]).toMatchObject({ done: true });
      expect(done.done).toBe(true);

      await run(tx, "untickStep", tick(serviceId, owner, w.steps.V1));
      expect(taskOf(await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW), w.steps.V1).steps[0]).toMatchObject({ done: false, doneAt: null });
      await run(tx, "replanService", { serviceId });
      const after = await actions(tx, "step_events");
      expect({ ins: after.ins - before.ins, upd: after.upd - before.upd, del: after.del - before.del }).toEqual({ ins: 3, upd: 0, del: 0 });
    });
  });

  it("D3: a second tick on a clock that stands still is stamped exactly 1 ms later", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx);
      const owner = dishOwner(w.dishes.veloute);
      await run(tx, "tickStep", tick(serviceId, owner, w.steps.V1));
      await run(tx, "untickStep", tick(serviceId, owner, w.steps.V1));
      const at = (await events(tx, serviceId, w.steps.V1)).map((e) => e.at.getTime()).sort();
      expect(at).toEqual([FIXED_NOW.getTime(), FIXED_NOW.getTime() + 1]);
    });
  });

  it("refuses a Step of another Recipe, a Dish of another Menu, another owner's Service and a removed Dish, writing nothing", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx);
      const veloute = dishOwner(w.dishes.veloute);
      await refused(tx, "tickStep", tick(serviceId, veloute, w.steps.T1));

      const menuId = crypto.randomUUID();
      const courseId = crypto.randomUUID();
      const elsewhere = crypto.randomUUID();
      await run(tx, "createMenu", { menuId, name: "Another dinner", guestCount: 2 });
      await run(tx, "addCourse", { courseId, menuId, name: "Starter" });
      await run(tx, "addDish", { dishId: elsewhere, courseId, recipeId: w.recipes.veloute });
      await refused(tx, "tickStep", tick(serviceId, dishOwner(elsewhere), w.steps.V1));

      await refused(tx, "untickStep", tick(serviceId, veloute, w.steps.V1), crypto.randomUUID());

      await tx.update(dishes).set({ deletedAt: sql`now()` }).where(eq(dishes.id, w.dishes.veloute));
      await refused(tx, "tickStep", tick(serviceId, veloute, w.steps.V1));
      const rows = await tx.select({ id: stepEvents.id }).from(stepEvents).where(eq(stepEvents.serviceId, serviceId));
      expect(rows).toEqual([]);
    });
  });

  it("refuses args that aren't a uuid or an owner of one kind", () => {
    const args = getMutator("tickStep")!.args;
    const id = () => crypto.randomUUID();
    expect(args.safeParse({ eventId: id(), serviceId: id(), owner: { kind: "dish", dishId: id() }, stepId: id() }).success).toBe(true);
    expect(args.safeParse({ eventId: "x", serviceId: id(), owner: { kind: "dish", dishId: id() }, stepId: id() }).success).toBe(false);
    expect(args.safeParse({ eventId: id(), serviceId: id(), owner: { kind: "dish", batchId: id() }, stepId: id() }).success).toBe(false);
    expect(args.safeParse({ eventId: id(), serviceId: id(), owner: { kind: "dish", dishId: id() }, stepId: id(), at: "now" }).success).toBe(false);
  });

  it("Batch: ticks a stock Step on its Batch, and refuses a Batch of another Service", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx, { stock: true });
      const stock = { kind: "batch", batchId: await batchId(serviceId, w.recipes.stock!) };
      await run(tx, "tickStep", tick(serviceId, stock, w.steps.S1!));
      expect(taskOf(await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW), w.steps.S1!)).toMatchObject({ owner: stock, done: true });

      // A second Menu that uses the stock, with its own Service and so its own stock Batch.
      const [menuId, courseId, otherService] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      await run(tx, "createMenu", { menuId, name: "Another dinner", guestCount: 2 });
      await run(tx, "addCourse", { courseId, menuId, name: "Starter" });
      await run(tx, "addDish", { dishId: crypto.randomUUID(), courseId, recipeId: w.recipes.veloute });
      await run(tx, "createService", { serviceId: otherService, menuId, date: SERVICE_DATE, time: SERVICE_TIME });
      const theirs = { kind: "batch", batchId: await batchId(otherService, w.recipes.stock!) };
      await refused(tx, "tickStep", tick(serviceId, theirs, w.steps.S1!));
    });
  });
});
