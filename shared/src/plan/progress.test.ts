import { describe, expect, it } from "vitest";
import { stepKey, stepStates } from "./progress.ts";

const owner = { kind: "dish", dishId: "d1" } as const;
const event = (id: string, kind: "done" | "undone", iso: string) => ({
  id,
  owner,
  stepId: "s1",
  kind,
  at: new Date(iso),
});

describe("stepStates", () => {
  it("reads a Step done after two ticks, keeping the first tick's time, and not done after an untick", () => {
    const ticks = [
      event("e2", "done", "2026-10-29T20:05:00Z"),
      event("e1", "done", "2026-10-29T20:00:00Z"),
    ];
    expect(stepStates(ticks).get(stepKey(owner, "s1"))).toEqual({
      done: true,
      doneAt: new Date("2026-10-29T20:00:00Z"),
    });

    const unticked = [...ticks, event("e3", "undone", "2026-10-29T20:10:00Z")];
    expect(stepStates(unticked).get(stepKey(owner, "s1"))).toEqual({ done: false, doneAt: null });
  });

  it("has no entry for a Step with no events", () => {
    expect(
      stepStates([event("e1", "done", "2026-10-29T20:00:00Z")]).get(stepKey(owner, "s2")),
    ).toBeUndefined();
  });

  it("reads tick, untick, tick as done at the last tick's time", () => {
    const events = [
      event("e1", "done", "2026-10-29T20:00:00Z"),
      event("e2", "undone", "2026-10-29T20:05:00Z"),
      event("e3", "done", "2026-10-29T20:10:00Z"),
    ];
    expect(stepStates(events).get(stepKey(owner, "s1"))).toEqual({
      done: true,
      doneAt: new Date("2026-10-29T20:10:00Z"),
    });
  });

  it("gives the same states whatever the order of its input", () => {
    const events = [
      event("e1", "done", "2026-10-29T20:00:00Z"),
      event("e2", "undone", "2026-10-29T20:05:00Z"),
      event("e3", "done", "2026-10-29T20:10:00Z"),
      event("e4", "done", "2026-10-29T20:15:00Z"),
    ];
    const expected = stepStates(events);
    for (const order of [
      [3, 2, 1, 0],
      [2, 0, 3, 1],
      [1, 3, 0, 2],
    ]) {
      expect(stepStates(order.map((i) => events[i]!))).toEqual(expected);
    }
  });

  it("keeps a Dish's and a Batch's Step with the same id apart", () => {
    const batch = { kind: "batch", batchId: "d1" } as const;
    const states = stepStates([
      event("e1", "done", "2026-10-29T20:00:00Z"),
      {
        id: "e2",
        owner: batch,
        stepId: "s1",
        kind: "undone",
        at: new Date("2026-10-29T20:05:00Z"),
      },
    ]);
    expect(stepKey(owner, "s1")).not.toBe(stepKey(batch, "s1"));
    expect(states.get(stepKey(owner, "s1"))).toEqual({
      done: true,
      doneAt: new Date("2026-10-29T20:00:00Z"),
    });
    expect(states.get(stepKey(batch, "s1"))).toEqual({ done: false, doneAt: null });
  });
});
