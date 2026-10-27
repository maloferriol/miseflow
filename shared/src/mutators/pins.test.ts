import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { inRollback } from "../../test/db.ts";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
} from "../../test/walkthrough.ts";
import { batchId } from "../plan/batch-rows.ts";
import { applyPlacements, withPin } from "../plan/pin.ts";
import { readPlan, type PlanRead } from "../plan/replan.ts";
import { zonedMinute } from "../plan/time.ts";
import { schedule } from "../scheduler/schedule.ts";
import { taskKey } from "../scheduler/types.ts";
import { taskPlacements } from "../schema.ts";
import { getMutator, InvalidArgsError, NotFoundError, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");
const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), {
    ownerId: owner,
    timeZone,
    now: () => FIXED_NOW,
  });
}

// The ADR 0004 walkthrough with its Chicken stock and Beurre blanc, its Service and Availability.
async function stockWalkthrough(tx: Tx) {
  const s = crypto.randomUUID().slice(0, 8);
  const w = await buildWalkthrough((name, args) => run(tx, name, args), s, { stock: true });
  await setWalkthroughAvailability((name, args) => run(tx, name, args));
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
  return { w, s, serviceId };
}

// Each live placement's start and pin, by the Step that keys its Task.
async function placements(tx: Tx, serviceId: string) {
  const rows = await tx
    .select({
      stepId: taskPlacements.firstStepId,
      start: taskPlacements.startMinute,
      pinned: taskPlacements.pinned,
    })
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
      await run(tx, "pinTask", {
        serviceId,
        owner: stock,
        firstStepId: w.steps.S1,
        start: wednesday18,
      });

      const after = await placements(tx, serviceId);
      expect(after.get(w.steps.S1!)).toEqual({ start: wednesday18, pinned: true });
      // Nothing else had to move.
      for (const [stepId, p] of before)
        if (stepId !== w.steps.S1) expect(after.get(stepId)).toEqual(p);

      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(taskOf(plan, w.steps.S1!)).toMatchObject({
        date: "2026-10-28",
        start: "18:00",
        end: "18:20",
        pinned: true,
      });
      expect(plan.unplaced).toEqual([]);
    });
  });

  it("AC4: refuses a start off the 5-minute grid; another owner's Service, an Unplaced Task and a Task of another Service are NotFound, writing nothing", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const stock = { kind: "batch", batchId: await batchId(serviceId, w.recipes.stock!) };
      const pin = (over: Record<string, unknown> = {}) => ({
        serviceId,
        owner: stock,
        firstStepId: w.steps.S1,
        start: wednesday18,
        ...over,
      });

      expect(getMutator("pinTask")!.args.safeParse(pin()).success).toBe(true);
      expect(await refused(tx, pin({ start: wednesday18 + 2 }))).toBeInstanceOf(ZodError);
      expect(await refused(tx, pin({ start: wednesday18 + 0.5 }))).toBeInstanceOf(ZodError);
      expect(await refused(tx, pin(), crypto.randomUUID())).toEqual(new NotFoundError("Service"));
      // Outside the window a pin can mean: before the start of the day 31 days before the Service
      // (a make-ahead window is at most 30 days), or after the Service itself (Sat 19:30).
      const serviceAt = zonedMinute(SERVICE_DATE, SERVICE_TIME, timeZone);
      const earliest = zonedMinute("2026-09-30", 0, timeZone);
      for (const start of [0, earliest - 5, serviceAt + 5])
        expect(await refused(tx, pin({ start }))).toBeInstanceOf(InvalidArgsError);

      // The pastry goes Unplaced when Friday's hours shrink (the walkthrough's step 5).
      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date: "2026-10-30",
        availability: { kind: "hours", start: h(19, 35), end: h(21) },
      });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced.map((u) => u.steps[0]!.id)).toEqual([w.steps.T1]);
      const tarte = { kind: "dish", dishId: w.dishes.tarte };
      expect(await refused(tx, pin({ owner: tarte, firstStepId: w.steps.T1 }))).toEqual(
        new NotFoundError("Task"),
      );

      // A second Menu with the Velouté and its own Service: its Task is not this Service's.
      const [menuId, courseId, dishId, otherService] = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      await run(tx, "createMenu", { menuId, name: "Another dinner", guestCount: 2 });
      await run(tx, "addCourse", { courseId, menuId, name: "Starter" });
      await run(tx, "addDish", { dishId, courseId, recipeId: w.recipes.veloute });
      await run(tx, "createService", {
        serviceId: otherService,
        menuId,
        date: SERVICE_DATE,
        time: SERVICE_TIME,
      });
      const theirs = { kind: "dish", dishId };
      expect((await placements(tx, otherService)).has(w.steps.V1)).toBe(true);
      expect(await refused(tx, pin({ owner: theirs, firstStepId: w.steps.V1 }))).toEqual(
        new NotFoundError("Task"),
      );

      const before = await placements(tx, serviceId);
      expect([...before.values()].some((p) => p.pinned)).toBe(false);
      expect(before.get(w.steps.S1!)!.start).not.toBe(wednesday18);

      // The window's ends, and a drop in a night seam (Thu 03:00), are pins like any other.
      for (const start of [earliest, serviceAt, zonedMinute("2026-10-29", h(3), timeZone)]) {
        await run(tx, "pinTask", pin({ start }));
        expect((await placements(tx, serviceId)).get(w.steps.S1!)).toEqual({ start, pinned: true });
      }
    });
  });

  it("AC4: pinTask re-plans: a pin over another Task's time moves that Task", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const at = (hours: number, minutes = 0) =>
        zonedMinute(SERVICE_DATE, h(hours, minutes), timeZone);
      const before = await placements(tx, serviceId);
      // Blend and season (V3) at 18:50 and Make the beurre blanc (D4) at 18:40, as the scheduler places them.
      expect(before.get(w.steps.V3)!.start).toBe(at(18, 50));
      expect(before.get(w.steps.D4)!.start).toBe(at(18, 40));

      await run(tx, "pinTask", {
        serviceId,
        owner: { kind: "dish", dishId: w.dishes.veloute },
        firstStepId: w.steps.V3,
        start: at(18, 40),
      });
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
      await run(tx, "pinTask", {
        serviceId,
        owner: { kind: "dish", dishId: w.dishes.veloute },
        firstStepId: w.steps.V3,
        start: at1840,
      });
      expect(second).toEqual(await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW));
    });
  });
});

// Inserts, updates and deletes on a table in this transaction so far (the stats are per transaction).
const tableWrites = async (tx: Tx, table: string) =>
  Number(
    (
      (await tx.execute(sql`select n_tup_ins + n_tup_upd + n_tup_del as n
      from pg_stat_xact_user_tables where relname = ${table}`)) as unknown as { n: string }[]
    )[0]?.n ?? 0,
  );

async function refusedUnpin(tx: Tx, args: unknown, owner = ownerId) {
  let thrown: unknown;
  await tx.transaction(async (sp) => run(sp, "unpinTask", args, owner)).catch((e) => (thrown = e));
  return thrown;
}

describe("unpinTask", () => {
  // The pastry's chill (T2) pinned at Fri 19:15 leaves the pastry (T1) no room: Friday's hours start at 19:00.
  const fri1915 = zonedMinute("2026-10-30", h(19, 15), timeZone);

  it("AC2: unpinTask on the blocking pin lets the blocked Task place", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const tarte = { kind: "dish" as const, dishId: w.dishes.tarte };
      await run(tx, "pinTask", {
        serviceId,
        owner: tarte,
        firstStepId: w.steps.T2,
        start: fri1915,
      });
      const blocked = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(blocked.unplaced.map((u) => [u.steps[0]!.id, u.kind])).toEqual([
        [w.steps.T1, "BlockedByPin"],
      ]);
      expect((await placements(tx, serviceId)).has(w.steps.T1)).toBe(false);

      // Expected: the re-plan with only the unpinned chill's previous start dropped (plan addendum 2).
      const chill = taskKey(tarte, w.steps.T2);
      const released = schedule({
        ...blocked.model,
        previous: blocked.model.previous.filter((p) => p.key !== chill),
      });
      expect(released.unplaced).toEqual([]);
      // Non-vacuous: a plain re-plan (the chill only set to pinned: false) still leaves the pastry Unplaced.
      const plain = schedule({
        ...blocked.model,
        previous: blocked.model.previous.map((p) => ({ ...p, pinned: false })),
      });
      expect(plain.unplaced.map((u) => [u.key, u.reason.kind])).toEqual([
        [taskKey(tarte, w.steps.T1), "NoAvailability"],
      ]);

      await run(tx, "unpinTask", { serviceId, owner: tarte, firstStepId: w.steps.T2 });
      const after = await placements(tx, serviceId);
      expect(after.get(w.steps.T2)!.pinned).toBe(false);
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toEqual([]);
      expect(new Map(plan.days.flatMap((d) => d.tasks).map((t) => [t.key, t.startMinute]))).toEqual(
        new Map(released.placements.map((p) => [p.key, p.start])),
      );
    });
  });

  it("the read names the pin that blocks a BlockedByPin Task, and offers it more time", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await stockWalkthrough(tx);
      const tarte = { kind: "dish" as const, dishId: w.dishes.tarte };
      await run(tx, "pinTask", {
        serviceId,
        owner: tarte,
        firstStepId: w.steps.T2,
        start: fri1915,
      });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toMatchObject([
        {
          kind: "BlockedByPin",
          blockingPin: {
            owner: tarte,
            firstStepId: w.steps.T2,
            label: `Chill the pastry (Tarte tatin ${s})`,
          },
          dishes: [{ id: w.dishes.tarte, name: `Tarte tatin ${s}` }],
          moreTime: true,
        },
      ]);
    });
  });

  it("AC2: unpinning a Task that isn't pinned, isn't placed, or is another owner's is NotFound, writing nothing", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await stockWalkthrough(tx);
      const tarte = { kind: "dish" as const, dishId: w.dishes.tarte };
      await run(tx, "pinTask", {
        serviceId,
        owner: tarte,
        firstStepId: w.steps.T2,
        start: fri1915,
      });
      const before = [await tableWrites(tx, "task_placements"), await placements(tx, serviceId)];
      // T3 is placed but not pinned; T1 is Unplaced, so it has no placement.
      expect(await refusedUnpin(tx, { serviceId, owner: tarte, firstStepId: w.steps.T3 })).toEqual(
        new NotFoundError("Task"),
      );
      expect(await refusedUnpin(tx, { serviceId, owner: tarte, firstStepId: w.steps.T1 })).toEqual(
        new NotFoundError("Task"),
      );
      expect(
        await refusedUnpin(
          tx,
          { serviceId, owner: tarte, firstStepId: w.steps.T2 },
          crypto.randomUUID(),
        ),
      ).toEqual(new NotFoundError("Service"));
      expect([await tableWrites(tx, "task_placements"), await placements(tx, serviceId)]).toEqual(
        before,
      );
    });
  });
});
