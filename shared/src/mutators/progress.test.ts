import { and, eq, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { db, inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, setWalkthroughAvailability } from "../../test/walkthrough.ts";
import { batchId } from "../plan/batch-rows.ts";
import { readPlan, type PlanRead } from "../plan/replan.ts";
import { localParts } from "../plan/time.ts";
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

// Each live placement row's version (ctid), by the Step that keys its Task: a row that's written changes it.
const versions = async (tx: Tx, serviceId: string) =>
  new Map(
    ((await tx.execute(sql`select first_step_id, ctid::text as v
      from task_placements where service_id = ${serviceId} and deleted_at is null`)) as unknown as Row[]).map((r) => [
      r.first_step_id as string,
      r.v as string,
    ]),
  );
const writes = async (tx: Tx, table: string) => {
  const a = await actions(tx, table);
  return a.ins + a.upd + a.del;
};
const minute = (date: Date) => date.getTime() / 60_000;
const at = (m: number) => new Date(m * 60_000);
const revisionId = () => crypto.randomUUID();

describe("Progress in the re-plan", () => {
  it("AC2, late tick: Add the stock ticked 40 minutes after its planned end pushes Blend and season later; nothing else moves", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx);
      // The Cook gets Saturday until Service after the Plan was made: the re-plan keeps every Task.
      const rows = await versions(tx, serviceId);
      await run(tx, "setAvailabilityOverride", { overrideId: crypto.randomUUID(), date: SERVICE_DATE, availability: { kind: "hours", start: 9 * 60, end: 19 * 60 + 30 } });
      expect(await versions(tx, serviceId)).toEqual(rows);

      const before = await starts(tx, serviceId);
      // V2: 5 minutes active, 20 passive.
      const plannedEnd = before.get(w.steps.V2)! + 25;
      const writesBefore = await writes(tx, "task_placements");
      await run(tx, "tickStep", tick(serviceId, dishOwner(w.dishes.veloute), w.steps.V2), { now: () => at(plannedEnd + 40) });

      const after = await starts(tx, serviceId);
      const changed = [...(await versions(tx, serviceId))].filter(([step, v]) => rows.get(step) !== v).map(([step]) => step);
      expect(changed).toEqual([w.steps.V3]);
      expect(after.get(w.steps.V2)).toBe(before.get(w.steps.V2));
      // Ready at the tick plus its 20 minutes of passive time.
      expect(after.get(w.steps.V3)).toBeGreaterThanOrEqual(plannedEnd + 40 + 20);
      expect(after.get(w.steps.V3)).toBeGreaterThan(before.get(w.steps.V3)!);
      expect(localParts(after.get(w.steps.V3)!, timeZone)).toMatchObject({ date: SERVICE_DATE, minuteOfDay: 19 * 60 + 20 });
      expect((await writes(tx, "task_placements")) - writesBefore).toBe(1);
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, at(plannedEnd + 40));
      expect(plan.conflicts).toEqual([]);
    });
  });

  // D1 (Dry-brine the duck) with 2700 minutes of passive time must start before Thu 21:50 to be
  // ready for Score and season on Saturday, so a re-plan moves it while it isn't done.
  const longBrine = (stepId: string) => ({ stepId, revisionId: revisionId(), activeMinutes: 10, passiveMinutes: 2700 });

  it("AC2, a done Task never moves: a longer brine moves Dry-brine the duck, unless it's ticked done", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx);
      const d1 = (await starts(tx, serviceId)).get(w.steps.D1)!;
      await tx
        .transaction(async (sp) => {
          await run(sp, "setStepTimes", longBrine(w.steps.D1));
          expect((await starts(sp, serviceId)).get(w.steps.D1)).not.toBe(d1);
          sp.rollback();
        })
        .catch((e) => expect(e).toBeInstanceOf(TransactionRollbackError));

      await run(tx, "tickStep", tick(serviceId, dishOwner(w.dishes.duck), w.steps.D1));
      const rows = await versions(tx, serviceId);
      await run(tx, "setStepTimes", longBrine(w.steps.D1));
      expect((await starts(tx, serviceId)).get(w.steps.D1)).toBe(d1);
      expect((await versions(tx, serviceId)).get(w.steps.D1)).toBe(rows.get(w.steps.D1));
    });
  });

  it("untick: a Task unticked is planned again, so the longer brine now moves it", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx);
      const duck = dishOwner(w.dishes.duck);
      const d1 = (await starts(tx, serviceId)).get(w.steps.D1)!;
      await run(tx, "tickStep", tick(serviceId, duck, w.steps.D1));
      await run(tx, "setStepTimes", longBrine(w.steps.D1));
      expect((await starts(tx, serviceId)).get(w.steps.D1)).toBe(d1);

      await run(tx, "untickStep", tick(serviceId, duck, w.steps.D1));
      const moved = (await starts(tx, serviceId)).get(w.steps.D1)!;
      expect(moved).toBeLessThan(d1);
      expect(localParts(moved, timeZone)).toMatchObject({ date: "2026-10-29", minuteOfDay: 20 * 60 + 10 });
    });
  });

  it("Outrun: Add the stock ticked so late that Blend and season can't follow keeps it placed with an Outrun conflict, until it's unticked", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await walkthrough(tx);
      const before = await starts(tx, serviceId);
      const tickAt = at(before.get(w.steps.V2)! + 25 + 40);
      const veloute = dishOwner(w.dishes.veloute);
      await run(tx, "tickStep", tick(serviceId, veloute, w.steps.V2), { now: () => tickAt });
      expect(await starts(tx, serviceId)).toEqual(before);
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, tickAt);
      expect(plan.unplaced).toEqual([]);
      expect(plan.conflicts.map((c) => ({ step: c.steps[0]!.id, kind: c.kind, use: c.use, sentence: c.sentence }))).toEqual([
        {
          step: w.steps.V3,
          kind: "Outrun",
          use: { key: `dish:${w.dishes.veloute}:${w.steps.V2}`, label: `Add the stock and simmer (Velouté ${s})` },
          sentence: `Blend and season (Velouté ${s}) starts at Sat 18:50, but Add the stock and simmer (Velouté ${s}) ran late and is only ready at Sat 19:20`,
        },
      ]);
      expect(taskOf(plan, w.steps.V3).steps).toEqual([{ id: w.steps.V3, text: "Blend and season", done: false, doneAt: null }]);
      expect(taskOf(plan, w.steps.V2).steps).toEqual([{ id: w.steps.V2, text: "Add the stock and simmer", done: true, doneAt: "19:00" }]);

      await run(tx, "untickStep", tick(serviceId, veloute, w.steps.V2), { now: () => tickAt });
      expect((await readPlan(tx, ownerId, serviceId, timeZone, tickAt)).conflicts).toEqual([]);
    });
  });
});

// Two transactions on two connections, ordered with awaits. The rows are committed, so they're
// soft-deleted afterwards (the Step events stay: the table is append-only). Sources:
// https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS (FOR KEY SHARE conflicts
// with FOR UPDATE only), https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW
describe("Service locks", () => {
  // replanService locks the Service with findService, a week's save with lockServices.
  const replanIt = (tx: Tx, serviceId: string, owner: string) => run(tx, "replanService", { serviceId }, { owner });
  const saveWeek = (tx: Tx, _serviceId: string, owner: string) => setWalkthroughAvailability((name, args) => run(tx, name, args, { owner }));
  it.each([
    ["re-plans", "saves the week", replanIt, saveWeek],
    ["saves the week", "saves the week", saveWeek, saveWeek],
  ] as const)("two writers that each add a Step event of a Service and then lock it don't deadlock: A %s, B %s", async (_a, _b, first, second) => {
    const owner = crypto.randomUUID();
    const clients = [0, 1].map(() => postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }));
    const [a, b] = clients.map((client) => drizzle({ client }));
    const as = (tx: Tx) => (name: string, args: Record<string, unknown>) => run(tx, name, args, { owner });
    const serviceId = crypto.randomUUID();
    try {
      let w!: Awaited<ReturnType<typeof buildWalkthrough>>;
      await db.transaction(async (tx) => {
        w = await buildWalkthrough(as(tx), owner.slice(0, 8));
        await setWalkthroughAvailability(as(tx));
        await as(tx)("createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
      });
      const [{ pid: pidOfA }] = (await clients[0]!`select pg_backend_pid() as pid`) as unknown as { pid: number }[];
      // Inserting a row that references the Service takes FOR KEY SHARE on it.
      const addEvent = (tx: Tx) =>
        tx.insert(stepEvents).values({ id: crypto.randomUUID(), ownerId: owner, serviceId, dishId: w.dishes.veloute, stepId: w.steps.V1, kind: "done", at: FIXED_NOW });

      let addedA!: () => void;
      const aAdded = new Promise<void>((resolve) => (addedA = resolve));
      let addedB!: () => void;
      const bAdded = new Promise<void>((resolve) => (addedB = resolve));
      let goOn!: () => void;
      const aWaitsOrIsDone = new Promise<void>((resolve) => (goOn = resolve));
      let settled = false;
      // A locks the Service once B holds its key share.
      const txA = a
        .transaction(async (tx) => {
          await addEvent(tx);
          addedA();
          await bAdded;
          await first(tx, serviceId, owner);
        })
        .finally(() => (settled = true));
      // B locks it once A is waiting for, or has, the Service's lock.
      const txB = b.transaction(async (tx) => {
        await aAdded;
        await addEvent(tx);
        addedB();
        await aWaitsOrIsDone;
        await second(tx, serviceId, owner);
      });
      await bAdded;
      while (!settled) {
        const [row] = (await db.execute(sql`select wait_event_type from pg_stat_activity where pid = ${pidOfA}`)) as unknown as Row[];
        if (row?.wait_event_type === "Lock") break;
      }
      goOn();

      const results = await Promise.allSettled([txA, txB]);
      expect(results.map((r) => (r.status === "rejected" ? String((r.reason as Error).cause ?? r.reason) : "ok"))).toEqual(["ok", "ok"]);
    } finally {
      await db.execute(sql`update services set deleted_at = now() where owner_id = ${owner} and deleted_at is null`);
      await db.execute(sql`update menus set deleted_at = now() where owner_id = ${owner} and deleted_at is null`);
      await db.execute(sql`update recipes set deleted_at = now() where owner_id = ${owner} and deleted_at is null`);
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
