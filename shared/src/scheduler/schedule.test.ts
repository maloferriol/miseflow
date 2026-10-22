import { describe, expect, it } from "vitest";
import { schedule, taskKey } from "./index.ts";
import { at, batchTask, dishTask, model, step } from "./fixtures.ts";

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
});
