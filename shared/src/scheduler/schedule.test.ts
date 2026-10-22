import { describe, expect, it } from "vitest";
import { schedule, taskKey } from "./index.ts";
import { at, batchTask, dishTask, model, step } from "./fixtures.ts";
import type { Plan } from "./index.ts";

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
});
