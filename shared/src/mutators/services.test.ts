import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { db, inRollback, underUncommittedChild } from "../../test/db.ts";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../../test/walkthrough.ts";
import { toPlanningModel } from "../plan/model.ts";
import { smallestOverride } from "../plan/more-time.ts";
import { planTrouble } from "../plan/trouble.ts";
import { ensureCook, loadAvailability, loadPlanRows, lockCook, readPlan } from "../plan/replan.ts";
import { schedule } from "../scheduler/schedule.ts";
import { taskKey } from "../scheduler/types.ts";
import { localParts, zonedMinute } from "../plan/time.ts";
import {
  availabilityOverrides,
  availabilityWeekly,
  cooks,
  courses,
  kitchenSettings,
  services,
  taskPlacements,
} from "../schema.ts";
import { ConflictError, getMutator, InvalidArgsError, NotFoundError, type Tx } from "./registry.ts";

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

const hours = (weekday: number, start: number, end: number) => ({
  availabilityId: crypto.randomUUID(),
  weekday,
  start,
  end,
});

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
      await run(tx, "setWeeklyAvailability", {
        hours: [hours(4, h(18), h(22)), hours(6, h(18), 1440)],
      });

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
    expect(
      mutator.args.safeParse({ hours: [hours(4, h(18), h(22)), hours(4, h(21), h(23))] }).success,
    ).toBe(false);
    expect(
      mutator.args.safeParse({ hours: [hours(4, h(18), h(22)), hours(5, h(21), h(23))] }).success,
    ).toBe(true);
  });

  it("sets a date's override, and kind weekly clears it", async () => {
    await inRollback(async (tx) => {
      const date = "2026-10-30";
      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date,
        availability: { kind: "hours", start: h(19), end: h(21) },
      });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([
        { id: expect.any(String), date, hours: { start: h(19), end: h(21) } },
      ]);
      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date,
        availability: { kind: "off" },
      });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([
        { id: expect.any(String), date, hours: null },
      ]);

      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date,
        availability: { kind: "weekly" },
      });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([]);
      const rows = await tx
        .select()
        .from(availabilityOverrides)
        .where(eq(availabilityOverrides.ownerId, ownerId));
      expect(rows).toHaveLength(2);
    });
  });

  it("saves the kitchen's default Service time in one settings row per owner", async () => {
    await inRollback(async (tx) => {
      await run(tx, "setKitchenSettings", { defaultServiceTime: h(19, 30) });
      await run(tx, "setKitchenSettings", { defaultServiceTime: h(18) });
      const rows = await tx
        .select()
        .from(kitchenSettings)
        .where(eq(kitchenSettings.ownerId, ownerId));
      expect(rows).toMatchObject([{ id: ownerId, defaultServiceTime: "18:00:00" }]);
    });
  });
});

// The walkthrough Menu with its Availability, for one owner, inside the test's transaction.
async function walkthrough(tx: Tx, owner = ownerId) {
  const w = await buildWalkthrough(
    (name, args) => run(tx, name, args, owner),
    crypto.randomUUID().slice(0, 8),
  );
  await setWalkthroughAvailability((name, args) => run(tx, name, args, owner));
  return w;
}

async function addService(
  tx: Tx,
  w: Walkthrough,
  time: number | null = SERVICE_TIME,
  owner = ownerId,
) {
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
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      const d4 = plan.days.flatMap((d) => d.tasks).find((t) => t.steps[0].id === s.D4)!;
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
    (
      (await tx.execute(sql`select n_tup_ins + n_tup_upd + n_tup_del as n
      from pg_stat_xact_user_tables where relname = 'task_placements'`)) as Row[]
    )[0]?.n ?? 0,
  );
const versions = async (tx: Tx, serviceId: string) =>
  new Map(
    (
      (await tx.execute(sql`select first_step_id, ctid::text as v
      from task_placements where service_id = ${serviceId} and deleted_at is null`)) as Row[]
    ).map((r) => [r.first_step_id as string, r.v as string]),
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

      await run(tx, "setStepTimes", {
        stepId: w.steps.V1,
        revisionId: crypto.randomUUID(),
        activeMinutes: 15,
        passiveMinutes: null,
      });

      const after = await placements(tx, serviceId);
      const moved = [...after]
        .filter(([step, at]) => starts.get(step) !== at)
        .map(([step]) => step);
      // V1 no longer fits before D3 at 17:40, so it moves to 17:25 and pushes D2 back to 17:15.
      expect(after.get(w.steps.V1)).toBe("Sat 17:25");
      expect(after.get(w.steps.D2)).toBe("Sat 17:15");
      expect(moved.sort()).toEqual([w.steps.V1, w.steps.D2].sort());
      expect(await writes(tx)).toBe(before + moved.length);
      const changed = [...(await versions(tx, serviceId))]
        .filter(([step, v]) => rows.get(step) !== v)
        .map(([step]) => step);
      expect(changed.sort()).toEqual(moved.sort());
    });
  });
});

// The live placements as "key@start", and what the scheduler makes of the current rows with the
// placements from before the edit as the previous Plan: what a re-plan after the edit must store.
async function stored(tx: Tx, serviceId: string) {
  const [service] = await tx.select().from(services).where(eq(services.id, serviceId));
  return (await loadPlanRows(tx, ownerId, service)).previous;
}
async function expectReplanned(
  tx: Tx,
  serviceId: string,
  before: Awaited<ReturnType<typeof stored>>,
  { moved = true } = {},
) {
  const [service] = await tx.select().from(services).where(eq(services.id, serviceId));
  const rows = await loadPlanRows(tx, ownerId, service);
  const { model, tasks } = toPlanningModel({ ...rows, previous: before }, timeZone);
  const live = rows.previous.map((p) => `${p.key}@${p.start}`).sort();
  // The edit must force a move, or this would pass with no re-plan at all.
  if (moved) expect(live).not.toEqual(before.map((p) => `${p.key}@${p.start}`).sort());
  expect(live).toEqual(
    schedule(model)
      .placements.map((p) => `${p.key}@${p.start}`)
      .sort(),
  );
  // No placement is left for a Task that no longer exists.
  expect(rows.previous.every((p) => tasks.has(p.key))).toBe(true);
}

const revisionId = () => crypto.randomUUID();
type Edit = [string, Record<string, unknown>];
// Each edit forces at least one placement to move. `setup` runs first, before the Plan is read.
const recipeEdits: [
  string,
  { setup?: (tx: Tx, w: Walkthrough) => Promise<void>; edit: (w: Walkthrough) => Edit },
][] = [
  [
    "addStep",
    {
      edit: (w) => [
        "addStep",
        {
          recipeId: w.recipes.veloute,
          stepId: crypto.randomUUID(),
          revisionId: revisionId(),
          body: [{ type: "text", text: "Garnish" }],
          lines: [],
        },
      ],
    },
  ],
  // With V1 and V2 grouped, moving V2 out of the group gives it its own Task key.
  [
    "moveStep",
    {
      setup: (tx, w) =>
        run(tx, "setGroupWithPrevious", {
          stepId: w.steps.V2,
          revisionId: revisionId(),
          value: true,
        }),
      edit: (w) => [
        "moveStep",
        { stepId: w.steps.V2, revisionId: revisionId(), afterStepId: w.steps.V3 },
      ],
    },
  ],
  ["removeStep", { edit: (w) => ["removeStep", { stepId: w.steps.V1, revisionId: revisionId() }] }],
  [
    "setStepTimes",
    {
      edit: (w) => [
        "setStepTimes",
        { stepId: w.steps.D3, revisionId: revisionId(), activeMinutes: 30, passiveMinutes: null },
      ],
    },
  ],
  // D1 becomes last-minute: it can no longer start on Thursday.
  [
    "setMakeAhead",
    {
      edit: (w) => [
        "setMakeAhead",
        {
          target: { kind: "step", stepId: w.steps.D1 },
          revisionId: revisionId(),
          window: { beforeDays: 0, shelfLifeDays: 3 },
        },
      ],
    },
  ],
  [
    "setGroupWithPrevious",
    {
      edit: (w) => [
        "setGroupWithPrevious",
        { stepId: w.steps.D3, revisionId: revisionId(), value: true },
      ],
    },
  ],
  // The walkthrough's Steps are already chained, so add a Step and make it wait for V3, which ends
  // at 19:00 when Saturday's hours close: it must move.
  [
    "addStepDependency",
    {
      setup: (tx, w) =>
        run(tx, "addStep", {
          recipeId: w.recipes.veloute,
          stepId: GARNISH,
          revisionId: revisionId(),
          body: [{ type: "text", text: "Garnish" }],
          lines: [],
        }),
      edit: (w) => [
        "addStepDependency",
        {
          dependencyId: crypto.randomUUID(),
          revisionId: revisionId(),
          beforeStepId: w.steps.V3,
          afterStepId: GARNISH,
        },
      ],
    },
  ],
  [
    "extractToSubRecipe",
    {
      edit: (w) => [
        "extractToSubRecipe",
        {
          recipeId: w.recipes.tarte,
          revisionId: revisionId(),
          stepIds: [w.steps.T1, w.steps.T2],
          subRecipeId: crypto.randomUUID(),
          subRecipeRevisionId: revisionId(),
          name: "Pastry",
          stepId: crypto.randomUUID(),
          lineId: crypto.randomUUID(),
        },
      ],
    },
  ],
];
const GARNISH = crypto.randomUUID();

describe("every edit that changes a Task re-plans", () => {
  it.each(recipeEdits)("%s re-plans the Services using the Recipe", async (_, { setup, edit }) => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      await setup?.(tx, w);
      const before = await stored(tx, serviceId);
      const [name, args] = edit(w);
      await run(tx, name, args);
      await expectReplanned(tx, serviceId, before);
    });
  });

  // Text only: no placement moves, so this only checks the stored Plan stays consistent.
  it("editStep keeps the stored Plan in step with the scheduler", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      const before = await stored(tx, serviceId);
      await run(tx, "editStep", {
        stepId: w.steps.V3,
        revisionId: revisionId(),
        body: [{ type: "text", text: "Blend" }],
        lines: [],
      });
      await expectReplanned(tx, serviceId, before, { moved: false });
    });
  });

  // Removing a link frees a Task but forces no move (previous starts that still fit are kept),
  // so this only checks the stored Plan stays consistent.
  it("removeStepDependency keeps the stored Plan in step with the scheduler", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      const [link] = (await tx.execute(
        sql`select id from step_dependencies where before_step_id = ${w.steps.T2} and deleted_at is null`,
      )) as Row[];
      const before = await stored(tx, serviceId);
      await run(tx, "removeStepDependency", { dependencyId: link.id, revisionId: revisionId() });
      await expectReplanned(tx, serviceId, before, { moved: false });
    });
  });

  it("addDish re-plans the Menu's Service", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      const before = await stored(tx, serviceId);
      const recipeId = crypto.randomUUID();
      await run(tx, "createRecipe", { recipeId, revisionId: revisionId(), name: "Bread" });
      await run(tx, "addStep", {
        recipeId,
        stepId: crypto.randomUUID(),
        revisionId: revisionId(),
        body: [{ type: "text", text: "Slice" }],
        lines: [],
      });
      const [course] = (await tx.execute(
        sql`select course_id from dishes where id = ${w.dishes.veloute}`,
      )) as Row[];
      await run(tx, "addDish", {
        dishId: crypto.randomUUID(),
        courseId: course.course_id,
        recipeId,
      });
      expect((await stored(tx, serviceId)).length).toBe(before.length + 1);
      await expectReplanned(tx, serviceId, before);
    });
  });

  it("setWeeklyAvailability re-plans every Service", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      const before = await stored(tx, serviceId);
      await run(tx, "setWeeklyAvailability", {
        hours: [hours(4, h(18), h(22)), hours(5, h(18), h(22)), hours(6, h(9), h(18))],
      });
      await expectReplanned(tx, serviceId, before);
    });
  });

  it("a shortened override leaves the pastry Unplaced with its reason and the rest stands", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      const rows = await versions(tx, serviceId);
      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date: "2026-10-30",
        availability: { kind: "hours", start: h(19, 35), end: h(21) },
      });

      const after = await versions(tx, serviceId);
      expect(after.has(w.steps.T1)).toBe(false);
      rows.delete(w.steps.T1);
      expect(after).toEqual(rows);
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toEqual([
        expect.objectContaining({
          kind: "NoAvailability",
          sentence: "No Cook has 20 free minutes between Fri 00:00 and Fri 19:50",
        }),
      ]);
      expect(plan.days.flatMap((d) => d.tasks)).toHaveLength(9);
    });
  });
});

// Runs a mutation that should be refused in a savepoint, so the checks after it can still run.
async function refused(tx: Tx, name: string, args: unknown, owner = ownerId) {
  let thrown: unknown;
  await tx.transaction(async (sp) => run(sp, name, args, owner)).catch((e) => (thrown = e));
  return thrown;
}
const tableWrites = async (tx: Tx, table: string) =>
  Number(
    (
      (await tx.execute(sql`select n_tup_ins + n_tup_upd + n_tup_del as n
      from pg_stat_xact_user_tables where relname = ${table}`)) as Row[]
    )[0]?.n ?? 0,
  );
const liveOverrides = (tx: Tx, owner = ownerId) =>
  tx
    .select({
      id: availabilityOverrides.id,
      date: availabilityOverrides.date,
      startTime: availabilityOverrides.startTime,
      endTime: availabilityOverrides.endTime,
    })
    .from(availabilityOverrides)
    .where(and(eq(availabilityOverrides.ownerId, owner), isNull(availabilityOverrides.deletedAt)));

const NO_FIT = "No extra time on one date fits this Task without moving others";
const TOO_MANY =
  "Too many options to check for this Task. Add hours on the Availability screen instead.";

describe("giveCookMoreTime", () => {
  it("giveCookMoreTime adds the smallest override, the pastry comes back, and every other placement's start is unchanged", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      // The walkthrough's step 5: Friday shortened to 19:35–21:00 leaves the pastry Unplaced.
      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date: "2026-10-30",
        availability: { kind: "hours", start: h(19, 35), end: h(21) },
      });
      const tarte = { kind: "dish" as const, dishId: w.dishes.tarte };
      expect(
        (await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW)).unplaced.map((u) => u.key),
      ).toEqual([taskKey(tarte, w.steps.T1)]);
      const [service] = await tx.select().from(services).where(eq(services.id, serviceId));
      const search = smallestOverride(
        await loadPlanRows(tx, ownerId, service),
        timeZone,
        taskKey(tarte, w.steps.T1),
      );
      if (search.kind !== "found") throw new Error(`expected a proposal, got ${search.kind}`);
      const expected = search.proposal;
      const rows = await versions(tx, serviceId);
      const starts = await placements(tx, serviceId);

      const overrideId = crypto.randomUUID();
      await run(tx, "giveCookMoreTime", {
        serviceId,
        owner: tarte,
        firstStepId: w.steps.T1,
        overrideId,
      });

      // The live override for Friday is the new row, with the smallest hours.
      expect(await liveOverrides(tx)).toEqual([
        {
          id: overrideId,
          date: "2026-10-30",
          startTime: `${String(Math.floor(expected.start / 60)).padStart(2, "0")}:${String(expected.start % 60).padStart(2, "0")}:00`,
          endTime: "21:00:00",
        },
      ]);
      expect(expected).toEqual({ date: "2026-10-30", start: h(19, 30), end: h(21) });
      const after = await versions(tx, serviceId);
      expect(after.has(w.steps.T1)).toBe(true);
      // Only the pastry's row is written: every other row is the same version, so the same start.
      expect(new Map([...after].filter(([step]) => step !== w.steps.T1))).toEqual(rows);
      const afterStarts = await placements(tx, serviceId);
      for (const [step, at] of starts) expect(afterStarts.get(step)).toBe(at);
      expect(afterStarts.get(w.steps.T1)).toBe("Fri 19:30");
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toEqual([]);
      expect(plan.days.flatMap((d) => d.tasks)).toHaveLength(10);
    });
  });

  it("gives a BlockedByPin Task more time: the pastry blocked by its chill pinned at Fri 19:15 comes back, and the pin and every other start stay", async () => {
    await inRollback(async (tx) => {
      // pins.test.ts's setup: the ADR 0004 walkthrough with its stock, T2 pinned at Fri 19:15.
      const w = await buildWalkthrough(
        (name, args) => run(tx, name, args),
        crypto.randomUUID().slice(0, 8),
        { stock: true },
      );
      await setWalkthroughAvailability((name, args) => run(tx, name, args));
      const serviceId = await addService(tx, w);
      const tarte = { kind: "dish" as const, dishId: w.dishes.tarte };
      await run(tx, "pinTask", {
        serviceId,
        owner: tarte,
        firstStepId: w.steps.T2,
        start: zonedMinute("2026-10-30", h(19, 15), timeZone),
      });
      const blocked = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(blocked.unplaced.map((u) => [u.steps[0].id, u.kind, u.moreTime])).toEqual([
        [w.steps.T1, "BlockedByPin", true],
      ]);
      const starts = await placements(tx, serviceId);

      const overrideId = crypto.randomUUID();
      await run(tx, "giveCookMoreTime", {
        serviceId,
        owner: tarte,
        firstStepId: w.steps.T1,
        overrideId,
      });

      // Friday's override starts 5 minutes earlier, so the pastry ends at the pinned chill.
      expect(await liveOverrides(tx)).toEqual([
        { id: overrideId, date: "2026-10-30", startTime: "18:55:00", endTime: "21:00:00" },
      ]);
      const afterStarts = await placements(tx, serviceId);
      for (const [step, at] of starts) expect(afterStarts.get(step)).toBe(at);
      expect(afterStarts.get(w.steps.T1)).toBe("Fri 18:55");
      expect(afterStarts.get(w.steps.T2)).toBe("Fri 19:15");
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toEqual([]);
      expect(plan.conflicts).toEqual([]);
    });
  });

  it("refuses a WindowTooTight Task with InvalidArgs and writes nothing", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      // 20 hours of pastry can't fit between Fri 00:00 and the chill at Fri 19:50, whatever the hours.
      await run(tx, "setStepTimes", {
        stepId: w.steps.T1,
        revisionId: revisionId(),
        activeMinutes: 1200,
        passiveMinutes: null,
      });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced.map((u) => u.kind)).toEqual(["WindowTooTight"]);
      const before = [
        await tableWrites(tx, "availability_overrides"),
        await tableWrites(tx, "task_placements"),
        await liveOverrides(tx),
      ];
      const thrown = await refused(tx, "giveCookMoreTime", {
        serviceId,
        owner: { kind: "dish", dishId: w.dishes.tarte },
        firstStepId: w.steps.T1,
        overrideId: crypto.randomUUID(),
      });
      expect(thrown).toEqual(new InvalidArgsError(NO_FIT));
      expect([
        await tableWrites(tx, "availability_overrides"),
        await tableWrites(tx, "task_placements"),
        await liveOverrides(tx),
      ]).toEqual(before);
    });
  });

  it("gives up when every override would push a placed predecessor and the search reaches its cap (#121), writing no override", async () => {
    await inRollback(async (tx) => {
      // P (30 min) then K (40 min), a Service on Fri 30 Oct 18:30, and only Fri 18:00–18:30, which P holds.
      const recipeId = crypto.randomUUID();
      const [p, k] = [crypto.randomUUID(), crypto.randomUUID()].sort();
      await run(tx, "createRecipe", { recipeId, revisionId: revisionId(), name: "Two steps" });
      for (const [stepId, active] of [
        [p, 30],
        [k, 40],
      ] as const) {
        await run(tx, "addStep", {
          recipeId,
          stepId,
          revisionId: revisionId(),
          body: [{ type: "text", text: stepId }],
          lines: [],
        });
        await run(tx, "setStepTimes", {
          stepId,
          revisionId: revisionId(),
          activeMinutes: active,
          passiveMinutes: null,
        });
      }
      await run(tx, "addStepDependency", {
        dependencyId: crypto.randomUUID(),
        revisionId: revisionId(),
        beforeStepId: p,
        afterStepId: k,
      });
      const [menuId, courseId, dishId, serviceId] = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      await run(tx, "createMenu", { menuId, name: "Friday", guestCount: 2 });
      await run(tx, "addCourse", { courseId, menuId, name: "Main" });
      await run(tx, "addDish", { dishId, courseId, recipeId });
      await run(tx, "setWeeklyAvailability", { hours: [hours(5, h(18), h(18, 30))] });
      await run(tx, "createService", { serviceId, menuId, date: "2026-10-30", time: h(18, 30) });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced.map((u) => [u.steps[0].id, u.kind])).toEqual([[k, "NoAvailability"]]);

      const before = [await tableWrites(tx, "availability_overrides"), await liveOverrides(tx)];
      const thrown = await refused(tx, "giveCookMoreTime", {
        serviceId,
        owner: { kind: "dish", dishId },
        firstStepId: k,
        overrideId: crypto.randomUUID(),
      });
      expect(thrown).toEqual(new InvalidArgsError(TOO_MANY));
      expect([await tableWrites(tx, "availability_overrides"), await liveOverrides(tx)]).toEqual(
        before,
      );
    });
  });

  it("refuses another owner's Service as missing", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      const thrown = await refused(
        tx,
        "giveCookMoreTime",
        {
          serviceId,
          owner: { kind: "dish", dishId: w.dishes.tarte },
          firstStepId: w.steps.T1,
          overrideId: crypto.randomUUID(),
        },
        crypto.randomUUID(),
      );
      expect(thrown).toEqual(new NotFoundError("Service"));
    });
  });
});

describe("replanFromScratch", () => {
  const at = (hours: number, minutes = 0) => zonedMinute(SERVICE_DATE, h(hours, minutes), timeZone);
  // Several moves (AC4, CONTEXT Pin: moving a Task pins it): Blend and season (V3) pinned at 18:40
  // pushes Make the beurre blanc (D4) to 18:50; Sweat the shallots (V1) pinned at Sat 10:00; then
  // V3 unpinned. D4 keeps 18:50 through a normal re-plan.
  async function moved(tx: Tx) {
    const w = await walkthrough(tx);
    const serviceId = await addService(tx, w);
    const veloute = { kind: "dish" as const, dishId: w.dishes.veloute };
    await run(tx, "pinTask", {
      serviceId,
      owner: veloute,
      firstStepId: w.steps.V3,
      start: at(18, 40),
    });
    await run(tx, "pinTask", { serviceId, owner: veloute, firstStepId: w.steps.V1, start: at(10) });
    await run(tx, "unpinTask", { serviceId, owner: veloute, firstStepId: w.steps.V3 });
    return { w, serviceId };
  }
  const startsOf = (placed: { key: string; start: number }[]) =>
    new Map(placed.map((p) => [p.key, p.start]));
  const storedStarts = async (tx: Tx, serviceId: string) =>
    new Map(
      (await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW)).days
        .flatMap((d) => d.tasks)
        .map((t) => [t.key, t.startMinute]),
    );

  it("AC4: after pinTask ×2 and unpinTask, replanFromScratch equals schedule({...model, previous: pins}) and the pin stays where it was", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await moved(tx);
      const read = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      const pins = read.model.previous.filter((p) => p.pinned);
      const v1 = taskKey({ kind: "dish", dishId: w.dishes.veloute }, w.steps.V1);
      expect(pins.map((p) => [p.key, p.start])).toEqual([[v1, at(10)]]);
      const fresh = schedule({ ...read.model, previous: pins });
      expect(fresh.unplaced).toEqual([]);
      // Not vacuous: a normal re-plan on the same input keeps D4 where the V3 pin pushed it.
      const normal = schedule(read.model);
      expect(startsOf(normal.placements)).toEqual(await storedStarts(tx, serviceId));
      expect(startsOf(fresh.placements)).not.toEqual(startsOf(normal.placements));

      await run(tx, "replanFromScratch", { serviceId });
      expect(await storedStarts(tx, serviceId)).toEqual(startsOf(fresh.placements));
      const after = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(after.model.previous.filter((p) => p.pinned).map((p) => [p.key, p.start])).toEqual([
        [v1, at(10)],
      ]);
      expect(after.unplaced).toEqual([]);
    });
  });

  it("AC4: a Task with a ticked Step keeps its start through replanFromScratch (owner decision 5)", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await moved(tx);
      const duck = { kind: "dish" as const, dishId: w.dishes.duck };
      await run(tx, "tickStep", {
        eventId: crypto.randomUUID(),
        serviceId,
        owner: duck,
        stepId: w.steps.D4,
      });
      const read = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      const d4 = taskKey(duck, w.steps.D4);
      const ticked = read.model.previous.find((p) => p.key === d4)!;
      expect(ticked.pinned).toBe(false);
      const pins = read.model.previous.filter((p) => p.pinned);
      const expected = schedule({ ...read.model, previous: [...pins, ticked] });
      expect(expected.unplaced).toEqual([]);
      // Not vacuous: from the pins alone, D4 would move.
      expect(startsOf(schedule({ ...read.model, previous: pins }).placements).get(d4)).not.toBe(
        ticked.start,
      );

      await run(tx, "replanFromScratch", { serviceId });
      const after = await storedStarts(tx, serviceId);
      expect(after.get(d4)).toBe(ticked.start);
      expect(after).toEqual(startsOf(expected.placements));
    });
  });

  it("refuses another owner's Service as missing, writing nothing", async () => {
    await inRollback(async (tx) => {
      const { serviceId } = await moved(tx);
      const before = [await tableWrites(tx, "task_placements"), await storedStarts(tx, serviceId)];
      expect(await refused(tx, "replanFromScratch", { serviceId }, crypto.randomUUID())).toEqual(
        new NotFoundError("Service"),
      );
      expect([await tableWrites(tx, "task_placements"), await storedStarts(tx, serviceId)]).toEqual(
        before,
      );
    });
  });
});

describe("Plan trouble and the Unplaced quick-fix fields", () => {
  it("AC5: planTrouble from readPlan is 1 after the shortening and 0 after giveCookMoreTime; the pastry offers more time and its own Dish", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      expect(planTrouble(await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW))).toBe(0);
      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date: "2026-10-30",
        availability: { kind: "hours", start: h(19, 35), end: h(21) },
      });
      const short = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(planTrouble(short)).toBe(1);
      const tarte = { id: w.dishes.tarte, name: w.names.tarte };
      expect(short.unplaced).toMatchObject([
        {
          steps: [{ id: w.steps.T1 }],
          kind: "NoAvailability",
          blockingPin: null,
          dishes: [tarte],
          moreTime: true,
        },
      ]);

      await run(tx, "giveCookMoreTime", {
        serviceId,
        owner: { kind: "dish", dishId: w.dishes.tarte },
        firstStepId: w.steps.T1,
        overrideId: crypto.randomUUID(),
      });
      expect(planTrouble(await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW))).toBe(0);
    });
  });

  it("a WindowTooTight Task offers no more time (owner decision 3)", async () => {
    await inRollback(async (tx) => {
      const w = await walkthrough(tx);
      const serviceId = await addService(tx, w);
      await run(tx, "setStepTimes", {
        stepId: w.steps.T1,
        revisionId: revisionId(),
        activeMinutes: 1200,
        passiveMinutes: null,
      });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toMatchObject([
        {
          kind: "WindowTooTight",
          blockingPin: null,
          dishes: [{ id: w.dishes.tarte, name: w.names.tarte }],
          moreTime: false,
        },
      ]);
      expect(planTrouble(plan)).toBe(1);
    });
  });

  it("an Unplaced Batch Task lists every top-level Dish the Batch feeds, through a parent Batch too (owner decision 4)", async () => {
    await inRollback(async (tx) => {
      const w = await buildWalkthrough(
        (name, args) => run(tx, name, args),
        crypto.randomUUID().slice(0, 8),
        { stock: true },
      );
      await setWalkthroughAvailability((name, args) => run(tx, name, args));
      const serviceId = await addService(tx, w);
      // Thursday off: the stock (made up to 3 days ahead) and the Beurre blanc have nowhere to go.
      await run(tx, "setAvailabilityOverride", {
        overrideId: crypto.randomUUID(),
        date: "2026-10-29",
        availability: { kind: "off" },
      });
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      const item = (stepId: string) => plan.unplaced.find((u) => u.steps[0].id === stepId)!;
      const veloute = { id: w.dishes.veloute, name: w.names.veloute };
      const duck = { id: w.dishes.duck, name: w.names.duck };
      // The stock feeds the Velouté and the Beurre blanc, which feeds the duck: both, in Menu order.
      expect(item(w.steps.S1!)).toMatchObject({
        dish: null,
        dishes: [veloute, duck],
        blockingPin: null,
        moreTime: true,
      });
      expect(item(w.steps.B1!)).toMatchObject({ dish: null, dishes: [duck], moreTime: true });
      expect(planTrouble(plan)).toBe(plan.unplaced.length + plan.conflicts.length);
    });
  });
});

// #113: the Cook and the Menu are locked FOR NO KEY UPDATE, so an uncommitted child row (which
// holds FOR KEY SHARE on its parent) doesn't block the lock, but two locks of one row still queue.
describe("Cook and Menu locks", () => {
  const softDelete = async (owner: string) => {
    for (const table of ["services", "menus", "recipes", "cooks"]) {
      await db.execute(
        sql`update ${sql.identifier(table)} set deleted_at = now() where owner_id = ${owner} and deleted_at is null`,
      );
    }
  };

  it("lockCook doesn't wait for an uncommitted Availability row of the Cook", async () => {
    const owner = crypto.randomUUID();
    try {
      await db.transaction(async (tx) => void (await ensureCook(tx, owner)));
      await underUncommittedChild(
        (tx) =>
          tx.insert(availabilityWeekly).values({
            id: crypto.randomUUID(),
            ownerId: owner,
            cookId: owner,
            weekday: 6,
            startTime: "09:00",
            endTime: "17:00",
          }),
        async (tx) => expect(await lockCook(tx, owner)).toBe(owner),
      );
    } finally {
      await softDelete(owner);
    }
  });

  it("createService doesn't wait for an uncommitted Course of the Menu", async () => {
    const owner = crypto.randomUUID();
    try {
      let w!: Walkthrough;
      await db.transaction(async (tx) => void (w = await walkthrough(tx, owner)));
      await underUncommittedChild(
        (tx) =>
          tx.insert(courses).values({
            id: crypto.randomUUID(),
            ownerId: owner,
            menuId: w.menuId,
            name: "Cheese",
            position: "z",
          }),
        async (tx) => {
          const serviceId = await addService(tx, w, SERVICE_TIME, owner);
          expect(
            await tx
              .select({ id: services.id })
              .from(services)
              .where(eq(services.menuId, w.menuId)),
          ).toEqual([{ id: serviceId }]);
        },
      );
    } finally {
      await softDelete(owner);
    }
  });

  // Two transactions on two connections, ordered with awaits: A creates the Service and stays open,
  // B waits on the Menu's lock, then reads A's Service once A commits.
  it("two concurrent createService calls for one Menu run one after another: the second gets 409", async () => {
    const owner = crypto.randomUUID();
    const clients = [0, 1].map(() =>
      postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }),
    );
    const [a, b] = clients.map((client) => drizzle({ client }));
    try {
      let w!: Walkthrough;
      await db.transaction(async (tx) => void (w = await walkthrough(tx, owner)));
      const [{ pid: pidOfB }] = (await clients[1]`select pg_backend_pid() as pid`) as unknown as {
        pid: number;
      }[];

      let created!: () => void;
      const aCreated = new Promise<void>((resolve) => (created = resolve));
      let goOn!: () => void;
      const bWaitsOrIsDone = new Promise<void>((resolve) => (goOn = resolve));
      const txA = a.transaction(async (tx) => {
        await addService(tx, w, SERVICE_TIME, owner);
        created();
        await bWaitsOrIsDone;
      });
      await aCreated;
      let settled = false;
      const txB = b
        .transaction(async (tx) => void (await addService(tx, w, SERVICE_TIME, owner)))
        .finally(() => (settled = true));
      let waited = false;
      while (!settled) {
        const [row] = (await db.execute(
          sql`select wait_event_type from pg_stat_activity where pid = ${pidOfB}`,
        )) as unknown as Record<string, unknown>[];
        if (row?.wait_event_type === "Lock") {
          waited = true;
          break;
        }
      }
      goOn();

      const results = await Promise.allSettled([txA, txB]);
      expect(waited).toBe(true);
      expect(results.map((r) => (r.status === "rejected" ? r.reason : "ok"))).toEqual([
        "ok",
        new ConflictError("This Menu already has a Service"),
      ]);
    } finally {
      await softDelete(owner);
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
