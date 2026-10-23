import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, setWalkthroughAvailability, type Walkthrough } from "../../test/walkthrough.ts";
import { batchId } from "../plan/batch-rows.ts";
import { toPlanningModel } from "../plan/model.ts";
import { loadPlanRows, readPlan } from "../plan/replan.ts";
import { localParts, zonedMinute } from "../plan/time.ts";
import { schedule } from "../scheduler/schedule.ts";
import { batches, dishes, services, taskPlacements } from "../schema.ts";
import { getMutator, type Tx } from "./registry.ts";

const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner, timeZone });
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
      const plan = await readPlan(tx, ownerId, serviceId, timeZone);
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
      expect((await readPlan(tx, ownerId, serviceId, timeZone)).batches.map((b) => b.label)).toEqual([
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
