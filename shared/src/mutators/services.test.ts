import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, setWalkthroughAvailability, type Walkthrough } from "../../test/walkthrough.ts";
import { ensureCook, loadAvailability, readPlan } from "../plan/replan.ts";
import { localParts } from "../plan/time.ts";
import { availabilityOverrides, availabilityWeekly, cooks, kitchenSettings, services, taskPlacements } from "../schema.ts";
import { ConflictError, getMutator, NotFoundError, type Tx } from "./registry.ts";

const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner, timeZone });
}

const hours = (weekday: number, start: number, end: number) => ({ availabilityId: crypto.randomUUID(), weekday, start, end });

describe("Availability and kitchen settings", () => {
  it("makes the implicit Cook with the owner's id, and a second ensureCook writes nothing", async () => {
    await inRollback(async (tx) => {
      expect(await ensureCook(tx, ownerId)).toBe(ownerId);
      const [first] = await tx.select().from(cooks).where(eq(cooks.id, ownerId));
      expect(await ensureCook(tx, ownerId)).toBe(ownerId);
      const rows = await tx.select().from(cooks).where(eq(cooks.ownerId, ownerId));
      expect(rows).toEqual([first]);
      expect(first).toMatchObject({ ownerId, name: "Me" });
    });
  });

  it("replaces the whole week, and stores an end at midnight as 24:00:00, read back as 1440", async () => {
    await inRollback(async (tx) => {
      await run(tx, "setWeeklyAvailability", { hours: [hours(1, h(9), h(12))] });
      await run(tx, "setWeeklyAvailability", { hours: [hours(4, h(18), h(22)), hours(6, h(18), 1440)] });

      const live = await tx
        .select({ weekday: availabilityWeekly.weekday, endTime: availabilityWeekly.endTime })
        .from(availabilityWeekly)
        .where(and(eq(availabilityWeekly.ownerId, ownerId), isNull(availabilityWeekly.deletedAt)));
      expect(live.map((r) => r.weekday).sort()).toEqual([4, 6]);
      expect(live.find((r) => r.weekday === 6)!.endTime).toBe("24:00:00");
      expect((await loadAvailability(tx, ownerId)).weekly).toEqual([
        { id: expect.any(String), weekday: 4, start: h(18), end: h(22) },
        { id: expect.any(String), weekday: 6, start: h(18), end: 1440 },
      ]);
    });
  });

  it("refuses hours that end before they start or overlap on one weekday", () => {
    const mutator = getMutator("setWeeklyAvailability")!;
    expect(mutator.args.safeParse({ hours: [hours(4, h(22), h(18))] }).success).toBe(false);
    expect(mutator.args.safeParse({ hours: [hours(4, h(18), h(22)), hours(4, h(21), h(23))] }).success).toBe(false);
    expect(mutator.args.safeParse({ hours: [hours(4, h(18), h(22)), hours(5, h(21), h(23))] }).success).toBe(true);
  });

  it("sets a date's override, and kind weekly clears it", async () => {
    await inRollback(async (tx) => {
      const date = "2026-10-30";
      await run(tx, "setAvailabilityOverride", { overrideId: crypto.randomUUID(), date, availability: { kind: "hours", start: h(19), end: h(21) } });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([{ id: expect.any(String), date, hours: { start: h(19), end: h(21) } }]);
      await run(tx, "setAvailabilityOverride", { overrideId: crypto.randomUUID(), date, availability: { kind: "off" } });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([{ id: expect.any(String), date, hours: null }]);

      await run(tx, "setAvailabilityOverride", { overrideId: crypto.randomUUID(), date, availability: { kind: "weekly" } });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([]);
      const rows = await tx.select().from(availabilityOverrides).where(eq(availabilityOverrides.ownerId, ownerId));
      expect(rows).toHaveLength(2);
    });
  });

  it("saves the kitchen's default Service time in one settings row per owner", async () => {
    await inRollback(async (tx) => {
      await run(tx, "setKitchenSettings", { defaultServiceTime: h(19, 30) });
      await run(tx, "setKitchenSettings", { defaultServiceTime: h(18) });
      const rows = await tx.select().from(kitchenSettings).where(eq(kitchenSettings.ownerId, ownerId));
      expect(rows).toMatchObject([{ id: ownerId, defaultServiceTime: "18:00:00" }]);
    });
  });
});

// The walkthrough Menu with its Availability, for one owner, inside the test's transaction.
async function walkthrough(tx: Tx, owner = ownerId) {
  const w = await buildWalkthrough((name, args) => run(tx, name, args, owner), crypto.randomUUID().slice(0, 8));
  await setWalkthroughAvailability((name, args) => run(tx, name, args, owner));
  return w;
}

async function addService(tx: Tx, w: Walkthrough, time: number | null = SERVICE_TIME, owner = ownerId) {
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time }, owner);
  return serviceId;
}

// Each live placement as "Sat 18:50", by the Step that keys its Task.
async function placements(tx: Tx, serviceId: string) {
  const rows = await tx
    .select({ stepId: taskPlacements.firstStepId, start: taskPlacements.startMinute })
    .from(taskPlacements)
    .where(and(eq(taskPlacements.serviceId, serviceId), isNull(taskPlacements.deletedAt)));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return new Map(
    rows.map((r) => {
      const p = localParts(r.start, timeZone);
      const hhmm = `${String(Math.floor(p.minuteOfDay / 60)).padStart(2, "0")}:${String(p.minuteOfDay % 60).padStart(2, "0")}`;
      return [r.stepId, `${day[p.weekday]} ${hhmm}`];
    }),
  );
}

describe("createService", () => {
  it("refuses a second Service for the same Menu", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      await addService(tx, w);
      await expect(addService(tx, w)).rejects.toThrow(ConflictError);
      expect(await tx.select().from(services).where(eq(services.menuId, w.menuId))).toHaveLength(1);
    });
  });

  it("plans a Service with no time to the kitchen's default, 19:00 until one is set", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w, null);
      expect((await placements(tx, serviceId)).get(w.steps.V3)).toBe("Sat 18:50");
      await run(tx, "setKitchenSettings", { defaultServiceTime: h(18) });
      expect((await placements(tx, serviceId)).get(w.steps.V3)).toBe("Sat 17:50");
      // A later Service time moves nothing that still fits: re-plan keeps previous starts.
      await run(tx, "setServiceTime", { serviceId, date: SERVICE_DATE, time: h(19, 30) });
      expect((await placements(tx, serviceId)).get(w.steps.V3)).toBe("Sat 17:50");
    });
  });

  it("refuses another owner's Menu as missing", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx, crypto.randomUUID());
      await expect(addService(tx, w)).rejects.toThrow(NotFoundError);
    });
  });
});

describe("the walkthrough Plan", () => {
  it("places the walkthrough Saturday 19:30 as late as possible, the beurre blanc ≈ for 10 minutes", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      const s = w.steps;
      expect(Object.fromEntries(await placements(tx, serviceId))).toEqual({
        [s.V1]: "Sat 17:30",
        [s.V2]: "Sat 17:55",
        [s.V3]: "Sat 18:50",
        [s.D1]: "Thu 21:50",
        [s.D2]: "Sat 17:20",
        [s.D3]: "Sat 17:40",
        [s.D4]: "Sat 18:40",
        [s.T1]: "Fri 19:30",
        [s.T2]: "Fri 19:50",
        [s.T3]: "Sat 18:00",
      });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone);
      const d4 = plan.days.flatMap((d) => d.tasks).find((t) => t.steps[0]!.id === s.D4)!;
      expect(d4).toMatchObject({ start: "18:40", end: "18:50", approximate: true });
      expect(plan.approximate).toBe(true);
      expect(plan.unplaced).toEqual([]);
    });
  });
});

// Row writes to task_placements so far in this transaction, and each live row's version.
// Sources: https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-STATS-VIEWS-TABLE
// ("counts actions taken so far within the current transaction"), and
// https://www.postgresql.org/docs/17/ddl-system-columns.html ("a row's ctid will change if it is updated").
type Row = Record<string, unknown>;
const writes = async (tx: Tx) =>
  Number(
    ((await tx.execute(sql`select n_tup_ins + n_tup_upd + n_tup_del as n
      from pg_stat_xact_user_tables where relname = 'task_placements'`)) as unknown as Row[])[0]?.n ?? 0,
  );
const versions = async (tx: Tx, serviceId: string) =>
  new Map(
    ((await tx.execute(sql`select first_step_id, ctid::text as v
      from task_placements where service_id = ${serviceId} and deleted_at is null`)) as unknown as Row[]).map((r) => [
      r.first_step_id as string,
      r.v as string,
    ]),
  );

describe("re-plan writes", () => {
  it("re-planning with nothing changed writes nothing", async () => {
    await inRollback(async (tx) => {
      const serviceId = await addService(tx, await walkthrough(tx));
      const before = await writes(tx);
      const rows = await versions(tx, serviceId);
      await run(tx, "replanService", { serviceId });
      await run(tx, "replanService", { serviceId });
      expect(await writes(tx)).toBe(before);
      expect(await versions(tx, serviceId)).toEqual(rows);
    });
  });

  it("changing one Step's duration rewrites only the placements that moved", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      const starts = await placements(tx, serviceId);
      const rows = await versions(tx, serviceId);
      const before = await writes(tx);

      await run(tx, "setStepTimes", { stepId: w.steps.V1, revisionId: crypto.randomUUID(), activeMinutes: 15, passiveMinutes: null });

      const after = await placements(tx, serviceId);
      const moved = [...after].filter(([step, at]) => starts.get(step) !== at).map(([step]) => step);
      // V1 no longer fits before D3 at 17:40, so it moves to 17:25 and pushes D2 back to 17:15.
      expect(after.get(w.steps.V1)).toBe("Sat 17:25");
      expect(after.get(w.steps.D2)).toBe("Sat 17:15");
      expect(moved.sort()).toEqual([w.steps.V1, w.steps.D2].sort());
      expect(await writes(tx)).toBe(before + moved.length);
      const changed = [...(await versions(tx, serviceId))].filter(([step, v]) => rows.get(step) !== v).map(([step]) => step);
      expect(changed.sort()).toEqual(moved.sort());
    });
  });
});
