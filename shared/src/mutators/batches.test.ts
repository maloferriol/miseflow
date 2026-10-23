import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { db, inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, setWalkthroughAvailability, type Walkthrough } from "../../test/walkthrough.ts";
import { batchId, readMenuScale } from "../plan/batch-rows.ts";
import { toPlanningModel } from "../plan/model.ts";
import { loadPlanRows, readPlan } from "../plan/replan.ts";
import { localParts, zonedMinute } from "../plan/time.ts";
import { schedule } from "../scheduler/schedule.ts";
import { batches, dishes, services, taskPlacements } from "../schema.ts";
import { getMutator, InvalidArgsError, NotFoundError, type Tx } from "./registry.ts";
import { lockRecipe } from "./revision.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");

const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner, timeZone, now: () => FIXED_NOW });
}

// The stock walkthrough with its Service and Availability, inside the test's transaction.
async function stockWalkthrough(tx: Tx) {
  const s = crypto.randomUUID().slice(0, 8);
  const w = await buildWalkthrough((name, args) => run(tx, name, args), s, { stock: true });
  await setWalkthroughAvailability((name, args) => run(tx, name, args));
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
  return { w, s, serviceId };
}

const liveBatches = (tx: Tx, serviceId: string) =>
  tx
    .select({ id: batches.id, subRecipeId: batches.subRecipeId, deletedAt: batches.deletedAt })
    .from(batches)
    .where(eq(batches.serviceId, serviceId));

// Each live placement's start, by the Step that keys its Task, and whether a Batch owns it.
async function placements(tx: Tx, serviceId: string) {
  const rows = await tx
    .select({ stepId: taskPlacements.firstStepId, batchId: taskPlacements.batchId, start: taskPlacements.startMinute })
    .from(taskPlacements)
    .where(and(eq(taskPlacements.serviceId, serviceId), isNull(taskPlacements.deletedAt)));
  return new Map(rows.map((r) => [r.stepId, r]));
}

const clock = (minute: number) => {
  const p = localParts(minute, timeZone);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday];
  return `${day} ${String(Math.floor(p.minuteOfDay / 60)).padStart(2, "0")}:${String(p.minuteOfDay % 60).padStart(2, "0")}`;
};

// Row writes to `table` so far in this transaction (#86's AC4 check).
// Source: https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-STATS-VIEWS-TABLE
type Row = Record<string, unknown>;
const writes = async (tx: Tx, table: string) =>
  Number(
    ((await tx.execute(sql`select n_tup_ins + n_tup_upd + n_tup_del as n
      from pg_stat_xact_user_tables where relname = ${table}`)) as unknown as Row[])[0]?.n ?? 0,
  );
const versions = async (tx: Tx, serviceId: string) =>
  new Map(
    ((await tx.execute(sql`select first_step_id, ctid::text as v
      from task_placements where service_id = ${serviceId} and deleted_at is null`)) as unknown as Row[]).map((r) => [
      r.first_step_id as string,
      r.v as string,
    ]),
  );

const revisionId = () => crypto.randomUUID();

describe("Batches in the re-plan", () => {
  it("AC2: Velouté and Beurre blanc share one Chicken stock Batch row labelled ×1.5", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await stockWalkthrough(tx);
      const rows = await liveBatches(tx, serviceId);
      const stock = rows.filter((b) => b.subRecipeId === w.recipes.stock);
      expect(stock).toEqual([{ id: await batchId(serviceId, w.recipes.stock!), subRecipeId: w.recipes.stock, deletedAt: null }]);
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.batches[0]!.label).toBe(`Chicken stock ${s} ×1.5 · for: Velouté ${s}, Beurre blanc ${s}`);
      expect(plan.batches[1]!.label).toBe(`Beurre blanc ${s} ×1 · for: Duck breast with beurre blanc ${s}`);
    });
  });

  it("re-planning with nothing changed writes no Batch row", async () => {
    await inRollback(async (tx) => {
      const { serviceId } = await stockWalkthrough(tx);
      const before = await writes(tx, "batches");
      await run(tx, "replanService", { serviceId });
      expect(await writes(tx, "batches")).toBe(before);
    });
  });

  it("AC3: removing the last Dish that uses the stock soft-deletes its Batch on the next re-plan", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await stockWalkthrough(tx);
      const stockId = await batchId(serviceId, w.recipes.stock!);
      // Stands in for #90's removeDish.
      await tx.update(dishes).set({ deletedAt: sql`now()` }).where(eq(dishes.id, w.dishes.veloute));
      await run(tx, "replanService", { serviceId });
      expect((await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW)).batches.map((b) => b.label)).toEqual([
        `Beurre blanc ${s} ×1 · for: Duck breast with beurre blanc ${s}`,
        `Chicken stock ${s} ×0.38 · for: Beurre blanc ${s}`,
      ]);

      await tx.update(dishes).set({ deletedAt: sql`now()` }).where(eq(dishes.id, w.dishes.duck));
      await run(tx, "replanService", { serviceId });
      const [row] = await tx.select().from(batches).where(eq(batches.id, stockId));
      expect(row!.deletedAt).not.toBeNull();
      const live = [...(await placements(tx, serviceId)).values()];
      expect(live.filter((p) => p.batchId !== null)).toEqual([]);
    });
  });

  it("AC3: an edit that drops the stock from every Recipe soft-deletes its Batch, and adding it back revives the same row", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const stockId = await batchId(serviceId, w.recipes.stock!);
      const plain = (text: string) => ({ body: [{ type: "text", text }], lines: [] });
      await run(tx, "editStep", { stepId: w.steps.V2, revisionId: revisionId(), ...plain("Add water and simmer") });
      await run(tx, "editStep", { stepId: w.steps.B1, revisionId: revisionId(), ...plain("Reduce the shallots in wine") });
      const [gone] = await tx.select().from(batches).where(eq(batches.id, stockId));
      expect(gone!.deletedAt).not.toBeNull();
      expect([...(await placements(tx, serviceId)).values()].some((p) => p.batchId === stockId)).toBe(false);

      const lineId = crypto.randomUUID();
      await run(tx, "editStep", {
        stepId: w.steps.V2,
        revisionId: revisionId(),
        body: [{ type: "text", text: "Add the " }, { type: "line", lineId }],
        lines: [{ lineId, subRecipeId: w.recipes.stock, amount: "1.5%L", wording: "stock" }],
      });
      expect(await liveBatches(tx, serviceId)).toContainEqual({ id: stockId, subRecipeId: w.recipes.stock, deletedAt: null });
      expect([...(await placements(tx, serviceId)).values()].filter((p) => p.batchId === stockId)).toHaveLength(3);
    });
  });

  it("AC4: the stock's Tasks are placed before every Task that uses it, on Thursday", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const at = await placements(tx, serviceId);
      const st = w.steps;
      const stockSteps = [st.S1!, st.S2!, st.S3!];
      const [service] = await tx.select().from(services).where(eq(services.id, serviceId));
      const rows = await loadPlanRows(tx, ownerId, service!);
      const { model, tasks } = toPlanningModel(rows, timeZone);
      const end = (stepId: string) => {
        const p = at.get(stepId)!;
        const task = [...tasks.values()].find((t) => t.stepIds[0] === stepId)!;
        return p.start + task.activeMinutes + task.passiveMinutes;
      };
      const users = [st.V1, st.V2, st.V3, st.B1!, st.B2!];
      const firstUse = Math.min(...users.map((id) => at.get(id)!.start));
      for (const id of stockSteps) {
        expect(end(id)).toBeLessThanOrEqual(firstUse);
        expect(localParts(at.get(id)!.start, timeZone).date).toBe("2026-10-29");
        expect(at.get(id)!.start).toBeGreaterThanOrEqual(zonedMinute("2026-10-28", 0, timeZone));
      }
      // As late as it can be: what the scheduler gives over the stored rows.
      const fresh = new Map(schedule({ ...model, previous: [] }).placements.map((p) => [p.key, p.start]));
      expect([...at.values()].map((p) => [p.stepId, p.start])).toEqual(
        expect.arrayContaining([...tasks.values()].map((t) => [t.stepIds[0], fresh.get(t.key)])),
      );
      expect(Object.fromEntries(stockSteps.concat(st.B1!, st.B2!, st.D1).map((id) => [id, clock(at.get(id)!.start)]))).toEqual({
        [st.S1!]: "Thu 18:20",
        [st.S2!]: "Thu 18:40",
        [st.S3!]: "Thu 20:50",
        [st.B1!]: "Thu 21:30",
        [st.B2!]: "Thu 21:40",
        [st.D1]: "Thu 21:50",
      });
    });
  });

  it("setStepTimes on a stock Step re-plans the Service that uses it through the Velouté and the Beurre blanc", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const before = await placements(tx, serviceId);
      const rows = await versions(tx, serviceId);
      await run(tx, "setStepTimes", { stepId: w.steps.S2!, revisionId: revisionId(), activeMinutes: 10, passiveMinutes: 140 });
      const after = await placements(tx, serviceId);
      const moved = [...after.values()].filter((p) => before.get(p.stepId)!.start !== p.start).map((p) => p.stepId);
      // A longer simmer must start earlier and pushes the roast back; nothing that uses the stock moves.
      expect(moved.sort()).toEqual([w.steps.S1!, w.steps.S2!].sort());
      const changed = [...(await versions(tx, serviceId))].filter(([step, v]) => rows.get(step) !== v).map(([step]) => step);
      expect(changed.sort()).toEqual(moved);
    });
  });
});

// Runs a mutation that should be refused in a savepoint, so the checks after it can still run.
async function refused(tx: Tx, name: string, args: unknown, error: new (...a: any[]) => Error, owner = ownerId) {
  let thrown: unknown;
  await tx.transaction(async (sp) => run(sp, name, args, owner)).catch((e) => (thrown = e));
  expect(thrown).toBeInstanceOf(error);
}

const scaleOf = async (tx: Tx, dishId: string) =>
  (await tx.select({ scaleFactor: dishes.scaleFactor }).from(dishes).where(eq(dishes.id, dishId)))[0]!.scaleFactor;

describe("setDishScale", () => {
  it("stores a factor, portions over the Recipe's servings, and clears back to the guest count", async () => {
    await inRollback(async (tx) => {
      const { w } = await stockWalkthrough(tx);
      await run(tx, "setDishScale", { dishId: w.dishes.duck, scale: { kind: "factor", factor: 2 } });
      expect(await scaleOf(tx, w.dishes.duck)).toBe("2");
      await run(tx, "setDishScale", { dishId: w.dishes.duck, scale: { kind: "portions", portions: 9 } });
      expect(await scaleOf(tx, w.dishes.duck)).toBe("1.5");
      await run(tx, "setDishScale", { dishId: w.dishes.duck, scale: { kind: "guests" } });
      expect(await scaleOf(tx, w.dishes.duck)).toBeNull();
    });
  });

  it("refuses portions on a Recipe with no servings, and another owner's Dish as missing", async () => {
    await inRollback(async (tx) => {
      const { w } = await stockWalkthrough(tx);
      await refused(tx, "setDishScale", { dishId: w.dishes.tarte, scale: { kind: "portions", portions: 8 } }, InvalidArgsError);
      await refused(tx, "setDishScale", { dishId: w.dishes.duck, scale: { kind: "factor", factor: 2 } }, NotFoundError, crypto.randomUUID());
      expect(await scaleOf(tx, w.dishes.duck)).toBeNull();
    });
  });

  it("refuses a factor that isn't positive or is over 1000", () => {
    const args = getMutator("setDishScale")!.args;
    const dishId = crypto.randomUUID();
    expect(args.safeParse({ dishId, scale: { kind: "factor", factor: 0 } }).success).toBe(false);
    expect(args.safeParse({ dishId, scale: { kind: "factor", factor: 1001 } }).success).toBe(false);
    expect(args.safeParse({ dishId, scale: { kind: "portions", portions: 1.5 } }).success).toBe(false);
  });

  it("a Velouté ×3 makes a bigger stock, and no placement moves", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await stockWalkthrough(tx);
      const rows = await versions(tx, serviceId);
      await run(tx, "setDishScale", { dishId: w.dishes.veloute, scale: { kind: "factor", factor: 3 } });
      expect((await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW)).batches[0]!.label).toBe(
        `Chicken stock ${s} ×2.63 · for: Velouté ${s}, Beurre blanc ${s}`,
      );
      expect(await versions(tx, serviceId)).toEqual(rows);
    });
  });
});

describe("Batch conflicts and fixes", () => {
  it("AC5: a stock kept 1 day is still placed on Thursday and shows ShelfLifeExceeded naming its latest use; the Plan stands", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await stockWalkthrough(tx);
      const before = await placements(tx, serviceId);
      await run(tx, "setMakeAhead", { target: { kind: "recipe", recipeId: w.recipes.stock! }, revisionId: revisionId(), window: { beforeDays: 3, shelfLifeDays: 1 } });
      const after = await placements(tx, serviceId);
      expect(after).toEqual(before);
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toEqual([]);
      const v3 = `dish:${w.dishes.veloute}:${w.steps.V3}`;
      // Only the finished stock (S3, the Batch's last Task) must keep; S1 and S2 feed S3.
      expect(plan.conflicts.map((c) => [c.steps[0]!.id, c.kind, c.use.key])).toEqual([[w.steps.S3, "ShelfLifeExceeded", v3]]);
      expect(plan.conflicts.find((c) => c.steps[0]!.id === w.steps.S3)!.sentence).toBe(
        `Strain the stock (Chicken stock ${s} ×1.5) keeps until Fri 21:30, but Blend and season (Velouté ${s}) uses it at Sat 18:50`,
      );
    });
  });

  it("AC5: a stock kept 2 days has no conflict: the finished stock keeps until Sat 21:30, though Roast the bones is ready Thu 18:40", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      await run(tx, "setMakeAhead", { target: { kind: "recipe", recipeId: w.recipes.stock! }, revisionId: revisionId(), window: { beforeDays: 3, shelfLifeDays: 2 } });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toEqual([]);
      expect(plan.conflicts).toEqual([]);
    });
  });

  it("AC5: stock Tasks pinned three days earlier stay put and show ShelfLifeExceeded; every other Task keeps its start", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const stockId = await batchId(serviceId, w.recipes.stock!);
      const before = await placements(tx, serviceId);
      // #89 adds pinTask; until then a pin is set in SQL.
      await tx.execute(sql`update task_placements set pinned = true, start_minute = start_minute - ${3 * 1440}
        where batch_id = ${stockId} and deleted_at is null`);
      await run(tx, "replanService", { serviceId });
      const after = await placements(tx, serviceId);
      for (const [stepId, p] of before) {
        const moved = p.batchId === stockId ? p.start - 3 * 1440 : p.start;
        expect(after.get(stepId)!.start).toBe(moved);
      }
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toEqual([]);
      expect(plan.conflicts.map((c) => [c.steps[0]!.id, c.kind])).toEqual([[w.steps.S3, "ShelfLifeExceeded"]]);
    });
  });

  it("AC6: a stock with no yield is planned as 1 batch and both Dishes show add a yield", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await stockWalkthrough(tx);
      await run(tx, "setYield", { recipeId: w.recipes.stock!, revisionId: revisionId(), yield: null });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.batches[0]).toMatchObject({ factor: 1, scalable: false, fix: "add a yield", label: `Chicken stock ${s} ×1 · for: Velouté ${s}, Beurre blanc ${s}` });
      const menu = await readMenuScale(tx, ownerId, w.menuId);
      const fix = { subRecipe: { id: w.recipes.stock, name: `Chicken stock ${s}` }, text: "add a yield" };
      expect(menu.dishes.find((d) => d.dishId === w.dishes.veloute)!.fixes).toEqual([fix]);
      expect(menu.dishes.find((d) => d.dishId === w.dishes.duck)!.fixes).toEqual([fix]);
      expect(menu.batches[0]).toMatchObject({ id: await batchId(serviceId, w.recipes.stock!), scalable: false });
    });
  });
});

// Two transactions on two connections, ordered with awaits. The rows are committed, so they're
// soft-deleted afterwards. Sources: https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS
// (FOR KEY SHARE conflicts with FOR UPDATE only), and
// https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW (wait_event_type "Lock").
describe("Batch rows and Recipe locks", () => {
  it("adding a Dish whose Recipe uses the stock, while a stock Step's times are saved, doesn't deadlock", async () => {
    const owner = crypto.randomUUID();
    const clients = [0, 1].map(() => postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }));
    const [a, b] = clients.map((client) => drizzle({ client }));
    const as = (tx: Tx) => (name: string, args: Record<string, unknown>) => run(tx, name, args, owner);
    const stockId = crypto.randomUUID();
    const stockStep = crypto.randomUUID();
    const soupId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    let w: Walkthrough | undefined;
    try {
      // The stock is a Dish of the Menu, so its edits re-plan the Service; the Soup uses it but isn't on the Menu yet.
      await db.transaction(async (tx) => {
        const r = as(tx);
        w = await buildWalkthrough(r, owner.slice(0, 8));
        await setWalkthroughAvailability(r);
        await r("createSubRecipe", { recipeId: stockId, revisionId: revisionId(), name: "Chicken stock", yield: "2 L" });
        await r("addStep", { recipeId: stockId, stepId: stockStep, revisionId: revisionId(), body: [{ type: "text", text: "Simmer" }], lines: [] });
        await r("setStepTimes", { stepId: stockStep, revisionId: revisionId(), activeMinutes: 10, passiveMinutes: null });
        const side = crypto.randomUUID();
        await r("addCourse", { courseId: side, menuId: w.menuId, name: "Side" });
        await r("addDish", { dishId: crypto.randomUUID(), courseId: side, recipeId: stockId });
        await r("createRecipe", { recipeId: soupId, revisionId: revisionId(), name: "Soup", servings: 6 });
        const lineId = crypto.randomUUID();
        await r("addStep", {
          recipeId: soupId,
          stepId: crypto.randomUUID(),
          revisionId: revisionId(),
          body: [{ type: "text", text: "Add the " }, { type: "line", lineId }],
          lines: [{ lineId, subRecipeId: stockId, amount: "1%L", wording: "stock" }],
        });
        await r("createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
      });
      const [starter] = (await db.execute(sql`select course_id from dishes where id = ${w!.dishes.veloute}`)) as unknown as Row[];
      const [{ pid: pidOfA }] = (await clients[0]!`select pg_backend_pid() as pid`) as unknown as { pid: number }[];

      let lockedStock!: () => void;
      const stockLocked = new Promise<void>((resolve) => (lockedStock = resolve));
      let goOn!: () => void;
      const aWaitsOrIsDone = new Promise<void>((resolve) => (goOn = resolve));
      // B: setStepTimes on the stock, paused right after it locks the stock Recipe.
      const txB = b.transaction(async (tx) => {
        await lockRecipe(tx, owner, stockId);
        lockedStock();
        await aWaitsOrIsDone;
        await run(tx, "setStepTimes", { stepId: stockStep, revisionId: revisionId(), activeMinutes: 15, passiveMinutes: null }, owner);
      });
      await stockLocked;
      // A: addDish locks the Service in its re-plan, then inserts the stock's Batch row.
      let settled = false;
      const txA = a
        .transaction(async (tx) => run(tx, "addDish", { dishId: crypto.randomUUID(), courseId: starter!.course_id, recipeId: soupId }, owner))
        .finally(() => (settled = true));
      while (!settled) {
        const [row] = (await db.execute(sql`select wait_event_type from pg_stat_activity where pid = ${pidOfA}`)) as unknown as Row[];
        if (row?.wait_event_type === "Lock") break;
      }
      goOn();

      const results = await Promise.allSettled([txA, txB]);
      expect(results.map((r) => (r.status === "rejected" ? String((r.reason as Error).cause ?? r.reason) : "ok"))).toEqual(["ok", "ok"]);
      const [batch] = (await db.execute(sql`select deleted_at from batches where service_id = ${serviceId} and sub_recipe_id = ${stockId}`)) as unknown as Row[];
      expect(batch).toEqual({ deleted_at: null });
    } finally {
      await db.execute(sql`update batches set deleted_at = now() where owner_id = ${owner} and deleted_at is null`);
      await db.execute(sql`update services set deleted_at = now() where owner_id = ${owner} and deleted_at is null`);
      await db.execute(sql`update menus set deleted_at = now() where owner_id = ${owner} and deleted_at is null`);
      await db.execute(sql`update recipes set deleted_at = now() where owner_id = ${owner} and deleted_at is null`);
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
