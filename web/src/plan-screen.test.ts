import { describe, expect, it, vi } from "vitest";
import { saturdayMenu, saturdayPlan } from "../test/plan-fixture.ts";
import { confirmedFix, ganttCourses, passive, pinTask, replanFromScratch } from "./plan-screen.ts";
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
      { id: "c-1", name: "Main", dishes: [{ id: "d-duck", name: "Duck breast" }] },
      { id: "c-2", name: "Dessert", dishes: [{ id: "d-tarte", name: "Tarte tatin" }] },
    ]);
  });
});

describe("pinTask", () => {
  it("pins the Task by its owner and first Step at the new start", () => {
    const duck = saturdayPlan.days[0].tasks[0];
    expect(pinTask("s-saturday", duck, 29_889_660)).toEqual({
      name: "pinTask",
      args: {
        serviceId: "s-saturday",
        owner: { kind: "dish", dishId: "d-duck" },
        firstStepId: "s-sear",
        start: 29_889_660,
      },
    });
  });
});

describe("replanFromScratch", () => {
  it("re-plans the Service", () => {
    expect(replanFromScratch("s-saturday")).toEqual({
      name: "replanFromScratch",
      args: { serviceId: "s-saturday" },
    });
  });
});

describe("confirmedFix", () => {
  const [moreTime, remove] = quickFixes("s-saturday", saturdayPlan.unplaced[0], () => "new-id");

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
