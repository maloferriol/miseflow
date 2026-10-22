import { describe, expect, it } from "vitest";
import { schedule } from "./index.ts";
import { at, dishTask, model } from "./fixtures.ts";

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
});
