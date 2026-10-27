import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
} from "../../test/walkthrough.ts";
import { getMutator, type Tx } from "../mutators/registry.ts";
import type { RecipeSnapshot } from "../recipe/snapshot.ts";
import { schedule } from "../scheduler/schedule.ts";
import { taskKey, type PreviousPlacement } from "../scheduler/types.ts";
import { services } from "../schema.ts";
import { type PlanRows, toPlanningModel } from "./model.ts";
import { MAX_TRIALS, smallestOverride, type OverrideProposal } from "./more-time.ts";
import { loadPlanRows } from "./replan.ts";
import { zonedMinute } from "./time.ts";

// "Give the Cook more time" (#90): the smallest one-date Availability override that places an
// Unplaced Task and moves no other placement. Every expected value is checked by a real
// `schedule()` run over the rows with the override in place.

const FIXED_NOW = new Date("2026-10-26T12:00:00Z");
const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

async function run(tx: Tx, name: string, args: unknown) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId, timeZone, now: () => FIXED_NOW });
}

// The rows with `proposal` as that date's only override.
const withOverride = (rows: PlanRows, p: OverrideProposal): PlanRows => ({
  ...rows,
  overrides: [
    ...rows.overrides.filter((o) => o.date !== p.date),
    { date: p.date, hours: { start: p.start, end: p.end } },
  ],
});

// The proposal the search found for `key`.
function found(rows: PlanRows, key: string): OverrideProposal {
  const result = smallestOverride(rows, timeZone, key);
  if (result.kind !== "found") throw new Error(`expected a proposal, got ${result.kind}`);
  return result.proposal;
}

// A refusal, proven or capped, within the cap's schedule() runs and a loose time backstop. The run
// count is the real gate: under CI's coverage, 50 schedule() runs over a 30-day window take ~1.6 s.
const TIME_BUDGET_MS = 3000;
function expectBoundedRefusal(rows: PlanRows, key: string) {
  const started = performance.now();
  const result = smallestOverride(rows, timeZone, key);
  const elapsed = performance.now() - started;
  expect(result.kind).not.toBe("found");
  expect(result.runs).toBeLessThanOrEqual(MAX_TRIALS);
  expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  return result;
}

// Whether a schedule() run over `rows` places `key`.
const placesAlone = (rows: PlanRows, key: string) =>
  schedule(toPlanningModel(rows, timeZone).model).placements.some((p) => p.key === key);

// The proposal places the Task and keeps every other start; 5 minutes less on the side that grew doesn't place it.
// A merge ("none") only fills the gap: the cheaper candidates are what the search tried before it.
function expectSmallest(
  rows: PlanRows,
  key: string,
  p: OverrideProposal,
  grew: "start" | "end" | "none",
) {
  const base = new Map(
    schedule(toPlanningModel(rows, timeZone).model).placements.map((x) => [x.key, x.start]),
  );
  const after = schedule(toPlanningModel(withOverride(rows, p), timeZone).model);
  expect(after.placements.some((x) => x.key === key)).toBe(true);
  for (const [k, start] of base)
    expect(after.placements.find((x) => x.key === k)?.start).toBe(start);
  if (grew === "none") return;
  const less = grew === "start" ? { ...p, start: p.start + 5 } : { ...p, end: p.end - 5 };
  if (less.end > less.start) expect(placesAlone(withOverride(rows, less), key)).toBe(false);
}

describe("smallestOverride on the walkthrough", () => {
  it("the smallest override for the Unplaced pastry places it, and 5 minutes less doesn't", async () => {
    await inRollback(async (tx) => {
      const w = await buildWalkthrough(
        (name, args) => run(tx, name, args),
        crypto.randomUUID().slice(0, 8),
      );
      await setWalkthroughAvailability((name, args) => run(tx, name, args), h(19, 35));
      const serviceId = crypto.randomUUID();
      await run(tx, "createService", {
        serviceId,
        menuId: w.menuId,
        date: SERVICE_DATE,
        time: SERVICE_TIME,
      });
      const [service] = await tx.select().from(services).where(eq(services.id, serviceId));
      const rows = await loadPlanRows(tx, ownerId, service);
      const key = taskKey({ kind: "dish", dishId: w.dishes.tarte }, w.steps.T1);
      expect(schedule(toPlanningModel(rows, timeZone).model).unplaced.map((u) => u.key)).toEqual([
        key,
      ]);

      const proposal = found(rows, key);
      // Friday's override starts earlier; ending later can't help, the pastry must be done by T2 at Fri 19:50.
      expect(proposal).toEqual({ date: "2026-10-30", start: h(19, 30), end: h(21) });
      expectSmallest(rows, key, proposal, "start");
    });
  });
});

describe("smallestOverride on a BlockedByPin Task", () => {
  it("the pastry blocked by its chill pinned at Fri 19:15: Friday starts earlier so it ends by the pin, and the pin stays", async () => {
    await inRollback(async (tx) => {
      // pins.test.ts's setup: the ADR 0004 walkthrough with its stock, T2 pinned at Fri 19:15.
      const w = await buildWalkthrough(
        (name, args) => run(tx, name, args),
        crypto.randomUUID().slice(0, 8),
        { stock: true },
      );
      await setWalkthroughAvailability((name, args) => run(tx, name, args));
      const serviceId = crypto.randomUUID();
      await run(tx, "createService", {
        serviceId,
        menuId: w.menuId,
        date: SERVICE_DATE,
        time: SERVICE_TIME,
      });
      const tarte = { kind: "dish" as const, dishId: w.dishes.tarte };
      const fri1915 = zonedMinute("2026-10-30", h(19, 15), timeZone);
      await run(tx, "pinTask", {
        serviceId,
        owner: tarte,
        firstStepId: w.steps.T2,
        start: fri1915,
      });
      const [service] = await tx.select().from(services).where(eq(services.id, serviceId));
      const rows = await loadPlanRows(tx, ownerId, service);
      const key = taskKey(tarte, w.steps.T1);
      expect(reasonOf(rows, key)).toBe("BlockedByPin");

      const proposal = found(rows, key);
      // Friday's 19:00 start moves 5 minutes earlier: the pastry's 20 minutes end at the pinned 19:15.
      expect(proposal).toEqual({ date: "2026-10-30", start: h(18, 55), end: h(21) });
      expectSmallest(rows, key, proposal, "start");
      const after = schedule(toPlanningModel(withOverride(rows, proposal), timeZone).model);
      expect(after.placements.find((p) => p.key === taskKey(tarte, w.steps.T2))).toMatchObject({
        start: fri1915,
      });
      expect(after.placements.find((p) => p.key === key)!.start).toBe(
        zonedMinute("2026-10-30", h(18, 55), timeZone),
      );
    });
  });
});

// A Recipe snapshot with plain Steps, built in the test.
type StepSpec = { id: string; active: number | null; passive?: number | null };
function recipe(
  steps: StepSpec[],
  makeAhead: { beforeDays: number; shelfLifeDays: number } | null = null,
): RecipeSnapshot {
  return {
    name: "R",
    servings: null,
    yield: null,
    makeAhead,
    steps: steps.map((s, i) => ({
      id: s.id,
      position: `a${i}`,
      body: [{ type: "text", text: s.id }],
      lines: [],
      activeMinutes: s.active,
      passiveMinutes: s.passive ?? null,
      makeAhead: null,
      groupWithPrevious: false,
    })),
    dependencies: steps
      .slice(1)
      .map((s, i) => ({ id: `l${i}`, beforeStepId: steps[i].id, afterStepId: s.id })),
  };
}

// One Service on Sat 31 Oct 2026 (Paris), the Dishes in order, and the Cook's hours.
function rows(
  dishes: { dishId: string; recipe: RecipeSnapshot }[],
  hours: {
    weekly?: PlanRows["weekly"];
    overrides?: PlanRows["overrides"];
    previous?: PreviousPlacement[];
    date?: string;
    time?: number;
  } = {},
): PlanRows {
  return {
    service: { id: "svc", date: hours.date ?? "2026-10-31", time: hours.time ?? h(19, 30) },
    defaultServiceTime: h(19),
    cookId: "cook",
    weekly: hours.weekly ?? [],
    overrides: hours.overrides ?? [],
    guestCount: 6,
    region: "metric",
    dishes: dishes.map((d) => ({
      dishId: d.dishId,
      recipeId: `r-${d.dishId}`,
      scaleFactor: null,
      recipe: d.recipe,
    })),
    subRecipes: new Map(),
    batches: [],
    previous: hours.previous ?? [],
    progress: new Map(),
  };
}

const SAT = 6;
const FRI = 5;
const dishKey = (dishId: string, stepId: string) => taskKey({ kind: "dish", dishId }, stepId);
const reasonOf = (r: PlanRows, key: string) =>
  schedule(toPlanningModel(r, timeZone).model).unplaced.find((u) => u.key === key)?.reason.kind;

describe("smallestOverride: the combinations grid", () => {
  it("weekly hours, end later: a new override from the weekly start, ending later; a tie with starting earlier goes to ending later", () => {
    // 30 active minutes, last-minute, and only Sat 09:00–09:20.
    const r = rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: 30 }]) }], {
      weekly: [{ weekday: SAT, start: h(9), end: h(9, 20) }],
    });
    const key = dishKey("d", "s1");
    expect(reasonOf(r, key)).toBe("NoAvailability");
    const p = found(r, key);
    expect(p).toEqual({ date: "2026-10-31", start: h(9), end: h(9, 30) });
    expectSmallest(r, key, p, "end");
    // Starting 10 minutes earlier would place it too, at the same cost.
    expect(
      placesAlone(withOverride(r, { date: "2026-10-31", start: h(8, 50), end: h(9, 20) }), key),
    ).toBe(true);
  });

  it("an override's hours, end later: the override grows the same way as weekly hours", () => {
    const r = rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: 30 }]) }], {
      weekly: [{ weekday: SAT, start: h(9), end: h(19) }],
      overrides: [{ date: "2026-10-31", hours: { start: h(9), end: h(9, 20) } }],
    });
    const key = dishKey("d", "s1");
    const p = found(r, key);
    expect(p).toEqual({ date: "2026-10-31", start: h(9), end: h(9, 30) });
    expectSmallest(r, key, p, "end");
  });

  it("weekly hours, start earlier: when the Task must end by the hours' end, they start earlier", () => {
    // Service at 09:20, so nothing after the hours' end helps.
    const r = rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: 30 }]) }], {
      weekly: [{ weekday: SAT, start: h(9), end: h(9, 20) }],
      time: h(9, 20),
    });
    const key = dishKey("d", "s1");
    const p = found(r, key);
    expect(p).toEqual({ date: "2026-10-31", start: h(8, 50), end: h(9, 20) });
    expectSmallest(r, key, p, "start");
  });

  it("no hours that date: a new range of exactly the active minutes, on the later date of a tie", () => {
    // Made up to a day ahead, so Friday and Saturday both could hold it; neither has hours.
    const r = rows([
      {
        dishId: "d",
        recipe: recipe([{ id: "s1", active: 25 }], { beforeDays: 1, shelfLifeDays: 2 }),
      },
    ]);
    const key = dishKey("d", "s1");
    expect(reasonOf(r, key)).toBe("NoAvailability");
    const p = found(r, key);
    expect(p).toEqual({ date: "2026-10-31", start: h(19, 5), end: h(19, 30) });
    expectSmallest(r, key, p, "start");
  });

  it("a date that is off (override with no hours) gets new hours", () => {
    const r = rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: 25 }]) }], {
      weekly: [{ weekday: SAT, start: h(9), end: h(19) }],
      overrides: [{ date: "2026-10-31", hours: null }],
    });
    const key = dishKey("d", "s1");
    const p = found(r, key);
    expect(p).toEqual({ date: "2026-10-31", start: h(19, 5), end: h(19, 30) });
    expectSmallest(r, key, p, "start");
  });

  it("two weekly ranges: one range covering both, the gap counted as added time", () => {
    // 30 active minutes; Sat 09:00–09:20 and 10:00–10:20, each too short.
    const two = [
      { weekday: SAT, start: h(9), end: h(9, 20) },
      { weekday: SAT, start: h(10), end: h(10, 20) },
    ];
    const r = rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: 30 }]) }], { weekly: two });
    const key = dishKey("d", "s1");
    const p = found(r, key);
    // Ending the later range 10 minutes later costs 10 minutes but drops the earlier range: one
    // override range holds both, so the 40-minute gap counts and the merge is the cheapest.
    expect(p).toEqual({ date: "2026-10-31", start: h(9), end: h(10, 20) });
    expectSmallest(r, key, p, "none");
    // Either range widened by the 10 minutes it lacks, but kept apart, would place it: one override can't.
    expect(placesAlone({ ...r, weekly: [two[0], { ...two[1], end: h(10, 30) }] }, key)).toBe(true);

    // With a day ahead allowed and Friday free of hours, 30 new minutes on Friday beat the 40-minute gap.
    const ahead = rows(
      [
        {
          dishId: "d",
          recipe: recipe([{ id: "s1", active: 30 }], { beforeDays: 1, shelfLifeDays: 2 }),
        },
      ],
      { weekly: two },
    );
    const q = found(ahead, key);
    expect(q).toEqual({ date: "2026-10-30", start: h(23, 30), end: h(24) });
    expectSmallest(ahead, key, q, "start");
  });

  it("active then passive past the hours' end: only the active time needs hours", () => {
    // 20 active then 2 h passive; Sat 09:00–09:15.
    const r = rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: 20, passive: 120 }]) }], {
      weekly: [{ weekday: SAT, start: h(9), end: h(9, 15) }],
    });
    const key = dishKey("d", "s1");
    const p = found(r, key);
    expect(p).toEqual({ date: "2026-10-31", start: h(9), end: h(9, 20) });
    expectSmallest(r, key, p, "end");
  });

  it("WindowTooTight: no Availability can help, so a proven refusal", () => {
    // 30 active minutes before a Service at 00:20.
    const r = rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: 30 }]) }], {
      time: h(0, 20),
    });
    const key = dishKey("d", "s1");
    expect(reasonOf(r, key)).toBe("WindowTooTight");
    expect(smallestOverride(r, timeZone, key)).toEqual({ kind: "none", runs: 0 });
  });

  it("a placed Task, or one that isn't there, gets a proven refusal", () => {
    const r = rows([{ dishId: "d", recipe: recipe([{ id: "s1", active: 30 }]) }], {
      weekly: [{ weekday: SAT, start: h(9), end: h(10) }],
    });
    expect(smallestOverride(r, timeZone, dishKey("d", "s1"))).toEqual({ kind: "none", runs: 0 });
    expect(smallestOverride(r, timeZone, dishKey("d", "nope"))).toEqual({ kind: "none", runs: 0 });
  });

  it("a candidate that would push a placed predecessor is rejected, and the next cheapest one is taken", () => {
    // P (30) then K (40) in one Dish, Sat 09:00–09:30 holding P; a pinned Q (another Dish) on
    // 09:30–10:00. Starting earlier (40 minutes) would put K before P and push P: rejected.
    const r = rows(
      [
        {
          dishId: "d",
          recipe: recipe([
            { id: "p", active: 30 },
            { id: "k", active: 40 },
          ]),
        },
        { dishId: "q", recipe: recipe([{ id: "q1", active: 30 }]) },
      ],
      {
        weekly: [{ weekday: SAT, start: h(9), end: h(9, 30) }],
        previous: [
          {
            key: dishKey("q", "q1"),
            start: zonedMinute("2026-10-31", h(9, 30), timeZone),
            cookId: "cook",
            pinned: true,
          },
          {
            key: dishKey("d", "p"),
            start: zonedMinute("2026-10-31", h(9), timeZone),
            cookId: "cook",
            pinned: false,
          },
        ],
      },
    );
    const key = dishKey("d", "k");
    expect(reasonOf(r, key)).toBe("NoAvailability");
    const earlier = { date: "2026-10-31", start: h(8, 20), end: h(9, 30) };
    const pushed = schedule(toPlanningModel(withOverride(r, earlier), timeZone).model);
    expect(pushed.placements.find((x) => x.key === key)).toBeDefined();
    expect(pushed.placements.find((x) => x.key === dishKey("d", "p"))!.start).not.toBe(
      zonedMinute("2026-10-31", h(9), timeZone),
    );

    const p = found(r, key);
    expect(p).toEqual({ date: "2026-10-31", start: h(9), end: h(10, 40) });
    expectSmallest(r, key, p, "end");
  });

  it("when every candidate would push a placed predecessor: a refusal within the cap", () => {
    // As above with the Service on Fri 18:30 and Fri 18:00–18:30 holding P: K can only go before P.
    const r = rows(
      [
        {
          dishId: "d",
          recipe: recipe([
            { id: "p", active: 30 },
            { id: "k", active: 40 },
          ]),
        },
      ],
      {
        date: "2026-10-30",
        time: h(18, 30),
        weekly: [{ weekday: FRI, start: h(18), end: h(18, 30) }],
        previous: [
          {
            key: dishKey("d", "p"),
            start: zonedMinute("2026-10-30", h(18), timeZone),
            cookId: "cook",
            pinned: false,
          },
        ],
      },
    );
    const key = dishKey("d", "k");
    expect(reasonOf(r, key)).toBe("NoAvailability");
    expect(expectBoundedRefusal(r, key)).toEqual({ kind: "capped", runs: MAX_TRIALS });
  });
});

describe("smallestOverride's refusal path stays bounded (#121)", () => {
  // P (30) then K (40) in one Dish, P held at the last minute before the Service: K can only go
  // after P, so every override that places K moves P earlier. Made up to 30 days ahead.
  const pushed = (
    fillers: number,
    hours: { weekly: PlanRows["weekly"]; date: string; time: number; pAt: number },
  ) =>
    rows(
      [
        {
          dishId: "d",
          recipe: recipe(
            [
              { id: "p", active: 30 },
              { id: "k", active: 40 },
            ],
            { beforeDays: 30, shelfLifeDays: 31 },
          ),
        },
        ...Array.from({ length: fillers }, (_, i) => ({
          dishId: `f${i}`,
          recipe: recipe([{ id: `f${i}s`, active: 20 }], { beforeDays: 30, shelfLifeDays: 31 }),
        })),
      ],
      {
        weekly: hours.weekly,
        date: hours.date,
        time: hours.time,
        previous: [
          {
            key: dishKey("d", "p"),
            start: zonedMinute(hours.date, hours.pAt, timeZone),
            cookId: "cook",
            pinned: false,
          },
        ],
      },
    );

  it("a 30-day make-ahead window, 10 Tasks, hours on Saturdays only", () => {
    // P and K plus 8 twenty-minute Tasks; each Saturday 09:00–09:30 holds P or one of them.
    const r = pushed(8, {
      weekly: [{ weekday: SAT, start: h(9), end: h(9, 30) }],
      date: "2026-10-31",
      time: h(9, 30),
      pAt: h(9),
    });
    const key = dishKey("d", "k");
    expect(reasonOf(r, key)).toBe("NoAvailability");
    expect(expectBoundedRefusal(r, key)).toEqual({ kind: "capped", runs: MAX_TRIALS });
  });

  it("a 30-day window with hours every day, where many candidates pass the pre-filter and each would push P", () => {
    // Every date's 18:00–18:30 widened by 10 minutes holds K, so each candidate needs a schedule() run.
    const r = pushed(0, {
      weekly: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        start: h(18),
        end: h(18, 30),
      })),
      date: "2026-10-30",
      time: h(18, 30),
      pAt: h(18),
    });
    const key = dishKey("d", "k");
    expect(reasonOf(r, key)).toBe("NoAvailability");
    expect(expectBoundedRefusal(r, key)).toEqual({ kind: "capped", runs: MAX_TRIALS });
  });
});
