import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SchedulerInputError, schedule, taskKey } from "./index.ts";
import { at, batchTask, dishTask, model, step } from "./fixtures.ts";
import type { Plan, PlanningModel } from "./index.ts";

function keysOnce(plan: Plan): string[] {
  return [...plan.placements.map((p) => p.key), ...plan.unplaced.map((u) => u.key)].sort();
}

describe("schedule", () => {
  it("AC2: last-minute Task starts on the Service date and finishes by Service time", () => {
    const service = at(0, 19, 30);
    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: service },
        free: [{ start: at(0, 9, 0), end: at(0, 19, 30) }],
        tasks: [dishTask("d1", [{ stepId: "s1", activeMinutes: 30, passiveMinutes: 0 }])],
      }),
    );

    expect(plan.placements).toEqual([
      { key: "dish:d1:s1", start: service - 30, end: service, cookId: "c1", pinned: false, approximate: false },
    ]);
    expect(plan.unplaced).toEqual([]);
  });

  it("AC2: Task key is owner plus first Step id", () => {
    expect(taskKey({ kind: "dish", dishId: "d1" }, "s1")).toBe("dish:d1:s1");
    expect(taskKey({ kind: "batch", batchId: "b1" }, "s7")).toBe("batch:b1:s7");

    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: at(0, 19, 30) },
        free: [{ start: at(0, 9, 0), end: at(0, 19, 30) }],
        tasks: [
          dishTask("d1", [step("s1", 10)]),
          batchTask("b1", [step("s7", 10)]),
          dishTask("d2", [step("first", 10), step("second", 10), step("third", 10)]),
        ],
      }),
    );

    expect(plan.placements.map((p) => p.key)).toEqual(["batch:b1:s7", "dish:d1:s1", "dish:d2:first"]);
  });

  it("AC2: prep-ahead Task lands as late as its window and dependencies allow", () => {
    // Stock may be made from Friday 09:00; the sauce that uses it is last-minute on Saturday.
    const plan = schedule(
      model({
        service: { dayStart: at(1, 0, 0), at: at(1, 19, 30) },
        free: [
          { start: at(0, 9, 0), end: at(0, 22, 0) },
          { start: at(1, 9, 0), end: at(1, 19, 30) },
        ],
        tasks: [
          batchTask("stock", [step("s1", 60)], at(0, 9, 0)),
          dishTask("sauce", [step("s1", 30)]),
        ],
        links: [{ before: "batch:stock:s1", after: "dish:sauce:s1" }],
      }),
    );

    expect(plan.unplaced).toEqual([]);
    const sauce = plan.placements.find((p) => p.key === "dish:sauce:s1")!;
    const stock = plan.placements.find((p) => p.key === "batch:stock:s1")!;
    expect(sauce).toMatchObject({ start: at(1, 19, 0), end: at(1, 19, 30) });
    expect(stock).toMatchObject({ start: at(1, 18, 0), end: sauce.start });
    expect(stock.start).toBeGreaterThanOrEqual(at(0, 9, 0));
  });

  it("AC2: Step with no duration uses a 10-minute active placeholder and marks the Task approximate", () => {
    const service = at(0, 19, 30);
    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: service },
        free: [{ start: at(0, 9, 0), end: service }],
        tasks: [
          dishTask("d1", [step("s1", 20), step("s2", null, null)]),
          dishTask("d2", [step("s1", null, 30)]),
        ],
      }),
    );

    expect(plan.placements).toEqual([
      // 20 active + 10 placeholder active: approximate.
      { key: "dish:d1:s1", start: service - 30, end: service, cookId: "c1", pinned: false, approximate: true },
      // Passive-only Step: active 0, not approximate; it overlaps d1 because only active time occupies the Cook.
      { key: "dish:d2:s1", start: service - 30, end: service, cookId: "c1", pinned: false, approximate: false },
    ]);
  });

  it("AC3: dependency chain placed in order with passive time running overnight", () => {
    const free = [
      { start: at(0, 18, 0), end: at(0, 22, 0) }, // Friday evening
      { start: at(1, 18, 0), end: at(1, 19, 30) }, // Saturday, until Service
    ];
    const tasks = [
      batchTask("stock", [step("start", 30, 180)], at(0, 18, 0)), // start, then simmer
      batchTask("stock", [step("skim", 20, 60)], at(0, 18, 0)), // skim, then cool
      dishTask("veloute", [step("make", 30)]),
      dishTask("veloute", [step("plate", null)]), // ≈ 10 min
    ];
    const chain = ["batch:stock:start", "batch:stock:skim", "dish:veloute:make", "dish:veloute:plate"];
    const plan = schedule(
      model({
        service: { dayStart: at(1, 0, 0), at: at(1, 19, 30) },
        free,
        tasks,
        links: chain.slice(1).map((after, i) => ({ before: chain[i]!, after })),
      }),
    );

    expect(plan.unplaced).toEqual([]);
    const byKey = new Map(plan.placements.map((p) => [p.key, p]));
    const [start, skim, make, plate] = chain.map((k) => byKey.get(k)!);
    expect([start, skim, make, plate].map((p) => [p!.start, p!.end])).toEqual([
      [at(0, 18, 10), at(0, 21, 40)],
      [at(0, 21, 40), at(0, 23, 0)],
      [at(1, 18, 50), at(1, 19, 20)],
      [at(1, 19, 20), at(1, 19, 30)],
    ]);
    // Each Task ends no later than its successor starts.
    for (let i = 1; i < chain.length; i++) expect(byKey.get(chain[i - 1]!)!.end).toBeLessThanOrEqual(byKey.get(chain[i]!)!.start);
    // Every active stretch lies inside one free interval.
    const active = [
      [start!.start, start!.start + 30],
      [skim!.start, skim!.start + 20],
      [make!.start, make!.end],
      [plate!.start, plate!.end],
    ];
    for (const [a, b] of active) expect(free.some((iv) => iv.start <= a! && b! <= iv.end)).toBe(true);
    // Cooling (skim end of active to Task end) runs outside Availability, overnight.
    const cooling = { start: skim!.start + 20, end: skim!.end };
    expect(free.some((iv) => iv.start < cooling.end && cooling.start < iv.end)).toBe(false);
    expect(plate!.approximate).toBe(true);
  });

  it("AC6: Unplaced NoAvailability carries minutes needed and the interval searched; the rest of the Plan stands", () => {
    const service = { dayStart: at(0, 0, 0), at: at(0, 19, 30) };
    const plan = schedule(
      model({
        service,
        // Only 30-minute gaps: a 60-minute active stretch never fits.
        free: [
          { start: at(0, 17, 0), end: at(0, 17, 30) },
          { start: at(0, 18, 0), end: at(0, 18, 30) },
          { start: at(0, 19, 0), end: at(0, 19, 30) },
        ],
        tasks: [
          dishTask("roast", [step("s1", 60)]),
          dishTask("garnish", [step("s1", 20)]),
          dishTask("prep", [step("s1", 30)]), // must finish before the roast
        ],
        links: [{ before: "dish:prep:s1", after: "dish:roast:s1" }],
      }),
    );

    expect(plan.unplaced).toEqual([
      { key: "dish:roast:s1", reason: { kind: "NoAvailability", minutesNeeded: 60, searched: { start: service.dayStart, end: service.at } } },
    ]);
    // The rest still stands; the unplaced roast's predecessor is planned against Service.
    expect(plan.placements.map((p) => [p.key, p.start])).toEqual([
      ["dish:garnish:s1", at(0, 19, 10)],
      ["dish:prep:s1", at(0, 18, 0)],
    ]);
    expect(keysOnce(plan)).toEqual(["dish:garnish:s1", "dish:prep:s1", "dish:roast:s1"]);
  });

  it("AC6: Unplaced BlockedByPin names the pin", () => {
    const service = { dayStart: at(0, 0, 0), at: at(0, 19, 30) };
    const plan = schedule(
      model({
        service,
        free: [{ start: at(0, 18, 0), end: at(0, 19, 30) }],
        tasks: [dishTask("pinned", [step("s1", 90)]), dishTask("late", [step("s1", 30)])],
        previous: [{ key: "dish:pinned:s1", start: at(0, 18, 0), cookId: "c1", pinned: true }],
      }),
    );

    expect(plan.placements.map((p) => p.key)).toEqual(["dish:pinned:s1"]);
    expect(plan.unplaced).toEqual([
      { key: "dish:late:s1", reason: { kind: "BlockedByPin", pin: "dish:pinned:s1", searched: { start: service.dayStart, end: service.at } } },
    ]);
    expect(keysOnce(plan)).toEqual(["dish:late:s1", "dish:pinned:s1"]);
  });

  it("AC6: Unplaced WindowTooTight carries the window", () => {
    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: at(0, 19, 30) },
        free: [{ start: at(0, 9, 0), end: at(0, 19, 30) }],
        tasks: [
          batchTask("dough", [step("s1", 30, 30)], at(0, 19, 0)), // 60 minutes, may start only at 19:00
          dishTask("salad", [step("s1", 15)]),
        ],
      }),
    );

    expect(plan.unplaced).toEqual([
      { key: "batch:dough:s1", reason: { kind: "WindowTooTight", minutesNeeded: 60, window: { start: at(0, 19, 0), end: at(0, 19, 30) } } },
    ]);
    expect(plan.placements.map((p) => [p.key, p.start])).toEqual([["dish:salad:s1", at(0, 19, 15)]]);
    expect(keysOnce(plan)).toEqual(["batch:dough:s1", "dish:salad:s1"]);
  });

  it("AC4: pinned Task stays exactly where it is, outside Availability and before its dependency, and the rest fits around it", () => {
    const plan = schedule(
      model({
        service: { dayStart: at(1, 0, 0), at: at(1, 19, 30) },
        free: [
          { start: at(0, 18, 0), end: at(0, 22, 0) },
          { start: at(1, 9, 0), end: at(1, 19, 30) },
        ],
        tasks: [
          batchTask("brine", [step("s1", 30)], at(0, 18, 0)),
          dishTask("cure", [step("s1", 30, 60)], at(0, 18, 0)), // pinned at 03:00, no Availability then
          dishTask("sear", [step("s1", 30)]), // pinned at 19:00, inside Availability
          dishTask("salad", [step("s1", 20)]), // unrelated, last-minute
        ],
        links: [{ before: "batch:brine:s1", after: "dish:cure:s1" }],
        previous: [
          { key: "dish:cure:s1", start: at(1, 3, 0), cookId: "c1", pinned: true },
          { key: "dish:sear:s1", start: at(1, 19, 0), cookId: "gone", pinned: true }, // unknown Cook: remapped
        ],
      }),
    );

    expect(plan.unplaced).toEqual([]);
    expect(plan.placements).toEqual([
      // Without the pin, brine would sit late on Saturday; it must finish before the pinned cure starts.
      { key: "batch:brine:s1", start: at(0, 21, 30), end: at(0, 22, 0), cookId: "c1", pinned: false, approximate: false },
      { key: "dish:cure:s1", start: at(1, 3, 0), end: at(1, 4, 30), cookId: "c1", pinned: true, approximate: false },
      // The salad avoids the sear pin's active time.
      { key: "dish:salad:s1", start: at(1, 18, 40), end: at(1, 19, 0), cookId: "c1", pinned: false, approximate: false },
      { key: "dish:sear:s1", start: at(1, 19, 0), end: at(1, 19, 30), cookId: "c1", pinned: true, approximate: false },
    ]);
  });

  it("AC5: stability – only the changed Task and what it pushes move", () => {
    // Saturday has eleven 30-minute islands (09:00, 10:00, …, 19:00); Friday evening is free for prep-ahead work.
    const service = { dayStart: at(1, 0, 0), at: at(1, 19, 30) };
    const free = [
      { start: at(0, 18, 0), end: at(0, 22, 0) },
      ...Array.from({ length: 11 }, (_, i) => ({ start: at(1, 9 + i, 0), end: at(1, 9 + i, 30) })),
    ];
    const links = [{ before: "batch:base:s1", after: "dish:jus:s1" }];
    const unrelated = Array.from({ length: 9 }, (_, i) => dishTask(`u0${i + 1}`, [step("s1", 30)]));
    const tasksWith = (jusActive: number) => [
      batchTask("base", [step("s1", 30)], at(0, 9, 0)),
      dishTask("jus", [step("s1", jusActive)], at(0, 9, 0)),
      ...unrelated,
    ];
    const startsOf = (plan: Plan) => new Map(plan.placements.map((p) => [p.key, p.start]));

    const first = schedule(model({ service, free, tasks: tasksWith(30), links }));
    expect(first.unplaced).toEqual([]);
    expect(startsOf(first).get("dish:jus:s1")).toBe(at(1, 19, 0));
    expect(startsOf(first).get("batch:base:s1")).toBe(at(1, 9, 0));
    const previous = first.placements.map((p) => ({ key: p.key, start: p.start, cookId: p.cookId, pinned: false }));

    // Unchanged model: exactly the same starts.
    const again = schedule(model({ service, free, tasks: tasksWith(30), links, previous }));
    expect(startsOf(again)).toEqual(startsOf(first));

    // The jus gains 20 minutes of active time. Worked by hand: 50 minutes fit no Saturday island, so
    // the nearest fit is Friday 21:10; that pushes its base to Friday 20:40. Every unrelated Task keeps
    // its start, though planning from scratch would slide each one into the island the jus left.
    const edited = schedule(model({ service, free, tasks: tasksWith(50), links, previous }));
    expect(edited.unplaced).toEqual([]);
    const before = startsOf(first);
    const after = startsOf(edited);
    const moved = [...after].filter(([key, start]) => before.get(key) !== start).map(([key]) => key);
    expect(moved.sort()).toEqual(["batch:base:s1", "dish:jus:s1"]);
    expect(after.get("dish:jus:s1")).toBe(at(0, 21, 10));
    expect(after.get("batch:base:s1")).toBe(at(0, 20, 40));
  });

  it("AC7: same input gives byte-identical output", () => {
    const input: PlanningModel = model({
      service: { dayStart: at(1, 0, 0), at: at(1, 19, 30) },
      free: [
        { start: at(0, 18, 0), end: at(0, 22, 0) },
        { start: at(1, 16, 0), end: at(1, 19, 30) },
      ],
      tasks: [
        batchTask("stock", [step("s1", 30, 180)], at(0, 18, 0)),
        dishTask("soup", [step("s1", 30), step("s2", null)]),
        dishTask("bread", [step("s1", 20, 60)], at(0, 18, 0)),
        dishTask("salad", [step("s1", 15)]),
        dishTask("roast", [step("s1", 300)]), // never fits: Unplaced
      ],
      links: [
        { before: "batch:stock:s1", after: "dish:soup:s1" },
        { before: "dish:bread:s1", after: "dish:soup:s1" },
      ],
      previous: [{ key: "dish:salad:s1", start: at(1, 19, 0), cookId: "c1", pinned: true }],
    });
    const reversed: PlanningModel = {
      ...input,
      tasks: [...input.tasks].reverse(),
      links: [...input.links].reverse(),
      previous: [...input.previous].reverse(),
    };

    const once = JSON.stringify(schedule(input));
    expect(JSON.stringify(schedule(input))).toBe(once);
    expect(JSON.stringify(schedule(reversed))).toBe(once);
  });

  it("AC7: ties broken by Task key", () => {
    // Two identical Tasks compete for the last slot before Service: the lower key gets the later one.
    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: at(0, 19, 30) },
        free: [{ start: at(0, 18, 30), end: at(0, 19, 30) }],
        tasks: [dishTask("b", [step("s1", 30)]), dishTask("a", [step("s1", 30)])],
      }),
    );

    expect(plan.placements.map((p) => [p.key, p.start])).toEqual([
      ["dish:a:s1", at(0, 19, 0)],
      ["dish:b:s1", at(0, 18, 30)],
    ]);
  });

  it("AC7: scheduler source has no clock or random calls", () => {
    const dir = new URL(".", import.meta.url);
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "fixtures.ts");
    expect(sources.sort()).toEqual(["index.ts", "schedule.ts", "timeline.ts", "types.ts"]);
    for (const file of sources) {
      const text = readFileSync(new URL(file, dir), "utf8");
      expect(text, file).not.toMatch(/\bDate\b|Math\.random|\bperformance\b|process\.hrtime/);
    }
  });

  it("AC2: last-minute Task never starts before the Service date, even when the day before is free", () => {
    const service = { dayStart: at(1, 0, 0), at: at(1, 19, 30) };
    const plan = schedule(
      model({
        service,
        free: [{ start: at(0, 9, 0), end: at(0, 22, 0) }], // only the day before Service is free
        tasks: [dishTask("d1", [step("s1", 30)])],
      }),
    );

    expect(plan.placements).toEqual([]);
    expect(plan.unplaced).toEqual([
      { key: "dish:d1:s1", reason: { kind: "NoAvailability", minutesNeeded: 30, searched: { start: service.dayStart, end: service.at } } },
    ]);
  });

  it("AC6: a dependency that can't fit before a pin is BlockedByPin naming the pin (decision 4)", () => {
    const plan = schedule(
      model({
        service: { dayStart: at(1, 0, 0), at: at(1, 19, 30) },
        free: [{ start: at(1, 9, 0), end: at(1, 19, 30) }],
        tasks: [
          dishTask("brine", [step("s1", 30)]), // last-minute: may not start before Saturday 00:00
          dishTask("cure", [step("s1", 30)]),
        ],
        links: [{ before: "dish:brine:s1", after: "dish:cure:s1" }],
        previous: [{ key: "dish:cure:s1", start: at(1, 3, 0), cookId: "c1", pinned: true }],
      }),
    );

    expect(plan.placements.map((p) => [p.key, p.start, p.pinned])).toEqual([["dish:cure:s1", at(1, 3, 0), true]]);
    expect(plan.unplaced).toEqual([
      { key: "dish:brine:s1", reason: { kind: "BlockedByPin", pin: "dish:cure:s1", searched: { start: at(1, 0, 0), end: at(1, 3, 0) } } },
    ]);
  });

  it("AC5: when the previous start no longer fits and two slots are equally near, the later one wins (decision 8)", () => {
    // Previous start 18:30 now has no free time. 18:00 and 19:00 are both 30 minutes away; 20:00 is the latest fit.
    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: at(0, 20, 30) },
        free: [
          { start: at(0, 18, 0), end: at(0, 18, 30) },
          { start: at(0, 19, 0), end: at(0, 19, 30) },
          { start: at(0, 20, 0), end: at(0, 20, 30) },
        ],
        tasks: [dishTask("d1", [step("s1", 30)])],
        previous: [{ key: "dish:d1:s1", start: at(0, 18, 30), cookId: "c1", pinned: false }],
      }),
    );

    expect(plan.placements.map((p) => [p.key, p.start])).toEqual([["dish:d1:s1", at(0, 19, 0)]]);
  });

  it("AC4: a pin for a Task that no longer exists is ignored (decision 9)", () => {
    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: at(0, 19, 30) },
        free: [{ start: at(0, 9, 0), end: at(0, 19, 30) }],
        tasks: [dishTask("d1", [step("s1", 30)])],
        previous: [{ key: "dish:gone:s1", start: at(0, 19, 0), cookId: "c1", pinned: true }],
      }),
    );

    expect(plan.placements.map((p) => [p.key, p.start])).toEqual([["dish:d1:s1", at(0, 19, 0)]]);
    expect(plan.unplaced).toEqual([]);
  });

  it("AC2: active 0 is a valid duration and not approximate (decision 6)", () => {
    const service = at(0, 19, 30);
    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: service },
        free: [{ start: at(0, 9, 0), end: service }],
        tasks: [dishTask("d1", [step("s1", 0, 30)])],
      }),
    );

    expect(plan.placements).toEqual([
      { key: "dish:d1:s1", start: service - 30, end: service, cookId: "c1", pinned: false, approximate: false },
    ]);
  });

  it("Decision 7: durations off the 5-minute grid are rounded up", () => {
    const service = at(0, 19, 30);
    const plan = schedule(
      model({
        service: { dayStart: at(0, 0, 0), at: service },
        free: [{ start: at(0, 9, 0), end: service }],
        tasks: [dishTask("d1", [step("s1", 7, 3)])], // 7 active -> 10, 3 passive -> 5
      }),
    );

    expect(plan.placements.map((p) => [p.start, p.end])).toEqual([[service - 15, service]]);
  });

  describe("Decision 7: malformed input throws SchedulerInputError", () => {
    const base = () =>
      model({
        service: { dayStart: at(0, 0, 0), at: at(0, 19, 30) },
        free: [{ start: at(0, 9, 0), end: at(0, 19, 30) }],
        tasks: [dishTask("a", [step("s1", 10)]), dishTask("b", [step("s1", 10)])],
      });
    const codeOf = (input: PlanningModel): string | undefined => {
      try {
        schedule(input);
      } catch (e) {
        expect(e).toBeInstanceOf(SchedulerInputError);
        return (e as SchedulerInputError).code;
      }
      return undefined;
    };

    it("throws Cycle for a dependency cycle", () => {
      const input = { ...base(), links: [{ before: "dish:a:s1", after: "dish:b:s1" }, { before: "dish:b:s1", after: "dish:a:s1" }] };
      expect(codeOf(input)).toBe("Cycle");
    });

    it("throws DuplicateTask for two Tasks with the same key", () => {
      const input = { ...base(), tasks: [dishTask("a", [step("s1", 10)]), dishTask("a", [step("s1", 20)])] };
      expect(codeOf(input)).toBe("DuplicateTask");
    });

    it("throws CookCount for no Cook", () => {
      expect(codeOf({ ...base(), cooks: [] })).toBe("CookCount");
    });

    it("throws CookCount for two Cooks", () => {
      const input = base();
      expect(codeOf({ ...input, cooks: [...input.cooks, { id: "c2", free: [] }] })).toBe("CookCount");
    });

    it("throws EmptyTask for a Task with no Steps", () => {
      expect(codeOf({ ...base(), tasks: [dishTask("a", [])] })).toBe("EmptyTask");
    });

    it("throws UnknownLinkTask for a link to a Task that does not exist", () => {
      expect(codeOf({ ...base(), links: [{ before: "dish:a:s1", after: "dish:nope:s1" }] })).toBe("UnknownLinkTask");
    });
  });
});
