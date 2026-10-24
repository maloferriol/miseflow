import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, setWalkthroughAvailability } from "../../test/walkthrough.ts";
import { batchId } from "../plan/batch-rows.ts";
import { applyPlacements, withPin } from "../plan/pin.ts";
import { readPlan, type PlanRead } from "../plan/replan.ts";
import { zonedMinute } from "../plan/time.ts";
import { schedule } from "../scheduler/schedule.ts";
import { taskKey } from "../scheduler/types.ts";
import { taskPlacements } from "../schema.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");
const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner, timeZone, now: () => FIXED_NOW });
}

// The ADR 0004 walkthrough with its Chicken stock and Beurre blanc, its Service and Availability.
async function stockWalkthrough(tx: Tx) {
  const s = crypto.randomUUID().slice(0, 8);
  const w = await buildWalkthrough((name, args) => run(tx, name, args), s, { stock: true });
  await setWalkthroughAvailability((name, args) => run(tx, name, args));
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
  return { w, s, serviceId };
}

// Each live placement's start and pin, by the Step that keys its Task.
async function placements(tx: Tx, serviceId: string) {
  const rows = await tx
    .select({ stepId: taskPlacements.firstStepId, start: taskPlacements.startMinute, pinned: taskPlacements.pinned })
    .from(taskPlacements)
    .where(and(eq(taskPlacements.serviceId, serviceId), isNull(taskPlacements.deletedAt)));
  return new Map(rows.map((r) => [r.stepId, { start: r.start, pinned: r.pinned }]));
}

const taskOf = (plan: PlanRead, stepId: string) => {
  const day = plan.days.find((d) => d.tasks.some((t) => t.steps[0]!.id === stepId))!;
  return { date: day.date, ...day.tasks.find((t) => t.steps[0]!.id === stepId)! };
};

// Runs a mutation that should be refused in a savepoint, so the checks after it can still run.
async function refused(tx: Tx, args: unknown, owner = ownerId) {
  let thrown: unknown;
  await tx.transaction(async (sp) => run(sp, "pinTask", args, owner)).catch((e) => (thrown = e));
  return thrown;
}

const wednesday18 = zonedMinute("2026-10-28", h(18), timeZone);

describe("pinTask", () => {
  it("AC4: pinTask moves Roast the bones to Wednesday 18:00 and pins it; the stored Plan shows it pinned there", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const stock = { kind: "batch", batchId: await batchId(serviceId, w.recipes.stock!) };
      const before = await placements(tx, serviceId);
      await run(tx, "pinTask", { serviceId, owner: stock, firstStepId: w.steps.S1, start: wednesday18 });

      const after = await placements(tx, serviceId);
      expect(after.get(w.steps.S1!)).toEqual({ start: wednesday18, pinned: true });
      // Nothing else had to move.
      for (const [stepId, p] of before) if (stepId !== w.steps.S1) expect(after.get(stepId)).toEqual(p);

      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(taskOf(plan, w.steps.S1!)).toMatchObject({ date: "2026-10-28", start: "18:00", end: "18:20", pinned: true });
      expect(plan.unplaced).toEqual([]);
    });
  });

  it("AC4: refuses a start off the 5-minute grid; another owner's Service, an Unplaced Task and a Task of another Service are NotFound, writing nothing", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const stock = { kind: "batch", batchId: await batchId(serviceId, w.recipes.stock!) };
      const pin = (over: Record<string, unknown> = {}) => ({ serviceId, owner: stock, firstStepId: w.steps.S1, start: wednesday18, ...over });

      expect(getMutator("pinTask")!.args.safeParse(pin()).success).toBe(true);
      expect(await refused(tx, pin({ start: wednesday18 + 2 }))).toBeInstanceOf(ZodError);
      expect(await refused(tx, pin({ start: wednesday18 + 0.5 }))).toBeInstanceOf(ZodError);
      expect(await refused(tx, pin(), crypto.randomUUID())).toEqual(new NotFoundError("Service"));

      // The pastry goes Unplaced when Friday's hours shrink (the walkthrough's step 5).
      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date: "2026-10-30",
        availability: { kind: "hours", start: h(19, 35), end: h(21) },
      });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced.map((u) => u.steps[0]!.id)).toEqual([w.steps.T1]);
      const tarte = { kind: "dish", dishId: w.dishes.tarte };
      expect(await refused(tx, pin({ owner: tarte, firstStepId: w.steps.T1 }))).toEqual(new NotFoundError("Task"));

      // A second Menu with the Velouté and its own Service: its Task is not this Service's.
      const [menuId, courseId, dishId, otherService] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      await run(tx, "createMenu", { menuId, name: "Another dinner", guestCount: 2 });
      await run(tx, "addCourse", { courseId, menuId, name: "Starter" });
      await run(tx, "addDish", { dishId, courseId, recipeId: w.recipes.veloute });
      await run(tx, "createService", { serviceId: otherService, menuId, date: SERVICE_DATE, time: SERVICE_TIME });
      const theirs = { kind: "dish", dishId };
      expect((await placements(tx, otherService)).has(w.steps.V1)).toBe(true);
      expect(await refused(tx, pin({ owner: theirs, firstStepId: w.steps.V1 }))).toEqual(new NotFoundError("Task"));

      const before = await placements(tx, serviceId);
      expect([...before.values()].some((p) => p.pinned)).toBe(false);
      expect(before.get(w.steps.S1!)!.start).not.toBe(wednesday18);
    });
  });

  it("AC4: pinTask re-plans: a pin over another Task's time moves that Task", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const at = (hours: number, minutes = 0) => zonedMinute(SERVICE_DATE, h(hours, minutes), timeZone);
      const before = await placements(tx, serviceId);
      // Blend and season (V3) at 18:50 and Make the beurre blanc (D4) at 18:40, as the scheduler places them.
      expect(before.get(w.steps.V3)!.start).toBe(at(18, 50));
      expect(before.get(w.steps.D4)!.start).toBe(at(18, 40));

      await run(tx, "pinTask", { serviceId, owner: { kind: "dish", dishId: w.dishes.veloute }, firstStepId: w.steps.V3, start: at(18, 40) });
      const after = await placements(tx, serviceId);
      expect(after.get(w.steps.V3)).toEqual({ start: at(18, 40), pinned: true });
      // D4 moves to where schedule() puts it with V3 pinned at 18:40.
      expect(after.get(w.steps.D4)).toEqual({ start: at(18, 50), pinned: false });
    });
  });

  it("AC4: applyPlacements(read, schedule(withPin(read.model, key, start))) equals readPlan after pinTask", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const owner = { kind: "batch" as const, batchId: await batchId(serviceId, w.recipes.stock!) };
      const key = taskKey(owner, w.steps.S1!);
      const read = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      const optimistic = applyPlacements(read, schedule(withPin(read.model, key, wednesday18)));

      await run(tx, "pinTask", { serviceId, owner, firstStepId: w.steps.S1, start: wednesday18 });
      const stored = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(optimistic).toEqual(stored);
      expect(optimistic.days[0]!.date).toBe("2026-10-28");

      // And the V3 pin, which moves D4.
      const v3 = taskKey({ kind: "dish", dishId: w.dishes.veloute }, w.steps.V3);
      const at1840 = zonedMinute(SERVICE_DATE, h(18, 40), timeZone);
      const second = applyPlacements(stored, schedule(withPin(stored.model, v3, at1840)));
      await run(tx, "pinTask", { serviceId, owner: { kind: "dish", dishId: w.dishes.veloute }, firstStepId: w.steps.V3, start: at1840 });
      expect(second).toEqual(await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW));
    });
  });
});
