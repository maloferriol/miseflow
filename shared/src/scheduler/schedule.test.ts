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
});
