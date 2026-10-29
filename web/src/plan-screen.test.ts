import { describe, expect, it, vi } from "vitest";
import {
  at,
  keys,
  SATURDAY,
  SERVICE_ID,
  saturdayMenu,
  taskIn,
  troubledPlan,
} from "../test/walkthrough-plan.ts";
import {
  confirmedFix,
  ganttCourses,
  lastPinSettling,
  noPinPending,
  optimisticPlan,
  passive,
  pinTask,
  replanFromScratch,
} from "./plan-screen.ts";
import { quickFixes } from "./quick-fixes.ts";

describe("passive", () => {
  it("reads minutes alone under an hour", () => {
    expect(passive(45)).toBe("45 min");
  });

  it("reads whole hours without minutes", () => {
    expect(passive(120)).toBe("2 h");
  });

  it("reads hours and minutes", () => {
    expect(passive(90)).toBe("1 h 30 min");
  });
});

describe("ganttCourses", () => {
  it("is each Course with its Dishes, named by Recipe", () => {
    expect(ganttCourses(saturdayMenu)).toEqual([
      { id: "c-0", name: "Starter", dishes: [{ id: "d-veloute", name: "Velouté" }] },
      {
        id: "c-1",
        name: "Main",
        dishes: [{ id: "d-duck", name: "Duck breast with beurre blanc" }],
      },
      { id: "c-2", name: "Dessert", dishes: [{ id: "d-tarte", name: "Tarte tatin" }] },
    ]);
  });
});

describe("pinTask", () => {
  it("pins the Task by its owner and first Step at the new start", () => {
    const duck = taskIn(troubledPlan, keys.duck);
    const start = at(SATURDAY, 18);
    expect(pinTask(SERVICE_ID, duck, start)).toEqual({
      name: "pinTask",
      args: {
        serviceId: SERVICE_ID,
        owner: { kind: "dish", dishId: "d-duck" },
        firstStepId: "D2",
        start,
      },
    });
  });
});

describe("optimisticPlan", () => {
  const duck = taskIn(troubledPlan, keys.duck);
  const start = at(SATURDAY, 17);

  it("pins the dragged Task at its new start and re-fits the rest", () => {
    const next = optimisticPlan(troubledPlan, duck, start)!;
    expect(taskIn(next, keys.duck)).toMatchObject({ startMinute: start, pinned: true });
    expect(next.model.previous).toContainEqual({
      key: keys.duck,
      start,
      cookId: "cook",
      pinned: true,
    });
    // The Beurre blanc the duck waits for moves earlier to fit.
    expect(taskIn(next, keys.beurre).startMinute).toBeLessThan(start);
    expect(taskIn(troubledPlan, keys.beurre).startMinute).toBeGreaterThan(start);
  });

  it("is undefined, leaving the cache alone, before the Plan is read", () => {
    expect(optimisticPlan(undefined, duck, start)).toBeUndefined();
  });
});

describe("the pins pending", () => {
  it("let the Plan refetch only when none is pending", () => {
    expect(noPinPending(0)).toBe(true);
    expect(noPinPending(1)).toBe(false);
  });

  it("read the Plan again only as the last one settles, itself still counted", () => {
    expect(lastPinSettling(1)).toBe(true);
    expect(lastPinSettling(2)).toBe(false);
  });
});

describe("replanFromScratch", () => {
  it("re-plans the Service", () => {
    expect(replanFromScratch(SERVICE_ID)).toEqual({
      name: "replanFromScratch",
      args: { serviceId: SERVICE_ID },
    });
  });
});

describe("confirmedFix", () => {
  const [moreTime, remove] = quickFixes(SERVICE_ID, troubledPlan.unplaced[0], () => "new-id");

  it("sends a fix with no question without asking", () => {
    const ask = vi.fn(() => false);
    expect(confirmedFix(moreTime, ask)).toEqual({ name: moreTime.name, args: moreTime.args });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks before removing a Dish, and sends the removal when the cook confirms", () => {
    const ask = vi.fn(() => true);
    expect(confirmedFix(remove, ask)).toEqual({
      name: "removeDish",
      args: { dishId: "d-tarte" },
    });
    expect(ask).toHaveBeenCalledWith("Remove Tarte tatin from the Menu?");
  });

  it("sends nothing when the cook cancels", () => {
    expect(confirmedFix(remove, () => false)).toBeNull();
  });
});
