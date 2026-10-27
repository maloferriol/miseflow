import { describe, expect, it } from "vitest";
import { effectiveMakeAhead, findPlanningCycle, readyToPlan, stepGroups } from "./planning.ts";
import type { RecipeSnapshot, SnapshotLine, SnapshotStep } from "./snapshot.ts";

describe("effectiveMakeAhead", () => {
  it("reads a Step's own make-ahead window, and its Recipe's for a Step without one", () => {
    const recipe = { makeAhead: { beforeDays: 3, shelfLifeDays: 4 } };
    expect(effectiveMakeAhead({ makeAhead: { beforeDays: 1, shelfLifeDays: 2 } }, recipe)).toEqual({
      beforeDays: 1,
      shelfLifeDays: 2,
      from: "step",
    });
    expect(effectiveMakeAhead({ makeAhead: null }, recipe)).toEqual({
      beforeDays: 3,
      shelfLifeDays: 4,
      from: "recipe",
    });
  });

  it("is null when neither has a window, and a Step's beforeDays 0 is its own window", () => {
    expect(effectiveMakeAhead({ makeAhead: null }, { makeAhead: null })).toBeNull();
    expect(
      effectiveMakeAhead(
        { makeAhead: { beforeDays: 0, shelfLifeDays: 0 } },
        { makeAhead: { beforeDays: 3, shelfLifeDays: 4 } },
      ),
    ).toEqual({ beforeDays: 0, shelfLifeDays: 0, from: "step" });
  });
});

const flag = (id: string, groupWithPrevious = false) => ({ id, groupWithPrevious });
const link = (beforeStepId: string, afterStepId: string) => ({ beforeStepId, afterStepId });

describe("stepGroups", () => {
  it("the first Step of a group is the Task's key Step, and a flag on the first Step is ignored", () => {
    expect(stepGroups([flag("a"), flag("b", true), flag("c"), flag("d", true)])).toEqual([
      { keyStepId: "a", stepIds: ["a", "b"] },
      { keyStepId: "c", stepIds: ["c", "d"] },
    ]);
    expect(stepGroups([flag("a", true), flag("b")])).toEqual([
      { keyStepId: "a", stepIds: ["a"] },
      { keyStepId: "b", stepIds: ["b"] },
    ]);
  });
});

describe("findPlanningCycle", () => {
  const plain = [flag("s1"), flag("s2"), flag("s3")];

  it("finds a self link", () => {
    expect(findPlanningCycle(plain, [link("s1", "s1")])).toEqual(["s1", "s1"]);
  });

  it("finds a 2-cycle and a 3-cycle, as the path around it", () => {
    expect(findPlanningCycle(plain, [link("s1", "s2"), link("s2", "s1")])).toEqual([
      "s1",
      "s2",
      "s1",
    ]);
    expect(
      findPlanningCycle(plain, [link("s1", "s2"), link("s2", "s3"), link("s3", "s1")]),
    ).toEqual(["s1", "s2", "s3", "s1"]);
    expect(findPlanningCycle(plain, [link("s1", "s2"), link("s2", "s3")])).toBeNull();
  });

  it("a forward link inside one group is not a cycle, a backward one is", () => {
    const grouped = [flag("s1"), flag("s2", true), flag("s3")];
    expect(findPlanningCycle(grouped, [link("s1", "s2")])).toBeNull();
    expect(findPlanningCycle(grouped, [link("s2", "s1")])).not.toBeNull();
  });

  it("a grouping that joins two ends of a chain is a cycle", () => {
    // s1 → s3 → s2, with s1 and s2 in one Task.
    const links = [link("s1", "s3"), link("s3", "s2")];
    expect(findPlanningCycle([flag("s1"), flag("s3"), flag("s2")], links)).toBeNull();
    expect(findPlanningCycle([flag("s1"), flag("s2", true), flag("s3")], links)).toEqual([
      "s1",
      "s3",
      "s2",
      "s1",
    ]);
  });
});

const line = (
  id: string,
  wording: string,
  preparation: string | null,
  ingredientId: string | null = null,
): SnapshotLine => ({
  id,
  ingredientId,
  subRecipeId: null,
  quantity: null,
  quantityMax: null,
  unit: null,
  wording,
  preparation,
  fixedQuantity: false,
  position: "a0",
});
const step = (
  id: string,
  text: string,
  times: { active?: number | null; passive?: number | null } = {},
  lines: SnapshotLine[] = [],
): SnapshotStep => ({
  id,
  position: "a0",
  body: [{ type: "text", text }, ...lines.map((l) => ({ type: "line" as const, lineId: l.id }))],
  lines,
  activeMinutes: times.active ?? null,
  passiveMinutes: times.passive ?? null,
  makeAhead: null,
  groupWithPrevious: false,
});
const recipe = (steps: SnapshotStep[]): RecipeSnapshot => ({
  name: "Sauce",
  servings: null,
  yield: null,
  makeAhead: null,
  steps,
  dependencies: [],
});

describe("ready to plan", () => {
  it("lists exactly the Steps with neither active nor passive time; active 0 counts as set", () => {
    const snapshot = recipe([
      step("s1", "Roast", { active: 10 }),
      step("s2", "Simmer"),
      step("s3", "Rest", { passive: 30 }),
      step("s4", "Strain", { active: 0 }),
      step("s5", "Cool"),
    ]);
    expect(readyToPlan(snapshot, new Map()).missingDuration).toEqual(["s2", "s5"]);
  });

  it("flags 'Dice the shallots' next to 'shallots, diced'", () => {
    const snapshot = recipe([
      step("s1", "Dice the shallots"),
      step("s2", "Sweat ", {}, [line("l1", "shallots", "diced")]),
    ]);
    expect(readyToPlan(snapshot, new Map()).duplicates).toEqual([{ stepId: "s1", lineId: "l1" }]);
  });

  it("does not flag 'Sweat the shallots'", () => {
    const snapshot = recipe([
      step("s1", "Sweat the shallots"),
      step("s2", "Add ", {}, [line("l1", "shallots", "diced")]),
    ]);
    expect(readyToPlan(snapshot, new Map()).duplicates).toEqual([]);
  });

  it("flags 'Finely chop the onion' next to 'onions, chopped', by the Ingredient's name", () => {
    const snapshot = recipe([
      step("s1", "Finely chop the onion"),
      step("s2", "Add ", {}, [line("l1", "brown ones", "chopped", "i-onion")]),
    ]);
    expect(readyToPlan(snapshot, new Map([["i-onion", "Onions"]])).duplicates).toEqual([
      { stepId: "s1", lineId: "l1" },
    ]);
  });

  it("does not flag a Step with no matching name", () => {
    const snapshot = recipe([
      step("s1", "Dice the carrots"),
      step("s2", "Add ", {}, [line("l1", "shallots", "diced")]),
    ]);
    expect(readyToPlan(snapshot, new Map()).duplicates).toEqual([]);
  });
});
