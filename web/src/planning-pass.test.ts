import { describe, expect, it } from "vitest";
import type { Recipe, RecipeStep } from "./api.ts";
import { createIntent } from "./intent.ts";
import {
  addLinkSave,
  clearsOwnWindow,
  groupSave,
  groupsWithPrevious,
  inheritedWindowText,
  linkChoices,
  makeAheadSave,
  opensOwnWindow,
  removeLinkSave,
  stepTimesInput,
  stepTimesSave,
  waitsFor,
  windowInput,
} from "./planning-pass.ts";

const anId: unknown = expect.any(String);

// ADR 0004's chicken stock: "made 3 days ahead and keeps 4".
const stockWindow = { beforeDays: 3, shelfLifeDays: 4 };

const step = (id: string, text: string): RecipeStep => ({
  id,
  position: "a0",
  body: [{ type: "text", text }],
  lines: [],
  activeMinutes: null,
  passiveMinutes: null,
  groupWithPrevious: false,
  makeAhead: null,
  effectiveMakeAhead: null,
});

const roast = step("s-roast", "Roast the bones");
const simmer = step("s-simmer", "Simmer for four hours");
const strain = step("s-strain", "Strain and cool");
const stock: Pick<Recipe, "steps" | "dependencies"> = {
  steps: [roast, simmer, strain],
  dependencies: [
    { id: "d-1", beforeStepId: "s-roast", afterStepId: "s-strain" },
    { id: "d-2", beforeStepId: "s-simmer", afterStepId: "s-strain" },
  ],
};

describe("Step times input", () => {
  it("saves both times as typed", () => {
    expect(stepTimesInput("20", "60")).toEqual({ activeMinutes: 20, passiveMinutes: 60 });
  });

  it("saves an empty field as no time, beside a typed one", () => {
    expect(stepTimesInput("", "240")).toEqual({ activeMinutes: null, passiveMinutes: 240 });
    expect(stepTimesInput("5", "  ")).toEqual({ activeMinutes: 5, passiveMinutes: null });
  });

  it("saves both empty as no times", () => {
    expect(stepTimesInput("", "")).toEqual({ activeMinutes: null, passiveMinutes: null });
  });
});

describe("Window input", () => {
  it("saves the days ahead and the shelf life as numbers", () => {
    expect(windowInput("3", "4")).toEqual(stockWindow);
  });
});

describe("Inherited window text", () => {
  it("names the window a Step inherits", () => {
    expect(inheritedWindowText(stockWindow)).toBe("Inherits 3 days ahead · keeps 4 days");
  });

  it("says Last-minute when there is no window to inherit", () => {
    expect(inheritedWindowText(null)).toBe("Last-minute");
  });
});

describe("Own window", () => {
  it("opens ticked when the Step has a window saved, unticked when not", () => {
    expect(opensOwnWindow({ makeAhead: stockWindow })).toBe(true);
    expect(opensOwnWindow({ makeAhead: null })).toBe(false);
  });

  // Each pair of the checkbox and whether the Step has a saved window.
  it("clears the window only when a saved one is unticked", () => {
    expect(clearsOwnWindow(false, { makeAhead: stockWindow })).toBe(true);
    expect(clearsOwnWindow(false, { makeAhead: null })).toBe(false);
    expect(clearsOwnWindow(true, { makeAhead: stockWindow })).toBe(false);
    expect(clearsOwnWindow(true, { makeAhead: null })).toBe(false);
  });
});

describe("Group with previous", () => {
  // Each pair of the Step's flag and whether it is the first Step.
  it("shows ticked only for a flagged Step that has a previous Step", () => {
    expect(groupsWithPrevious({ groupWithPrevious: true }, 1)).toBe(true);
    expect(groupsWithPrevious({ groupWithPrevious: true }, 0)).toBe(false);
    expect(groupsWithPrevious({ groupWithPrevious: false }, 1)).toBe(false);
    expect(groupsWithPrevious({ groupWithPrevious: false }, 0)).toBe(false);
  });
});

describe("Links", () => {
  it("offers every other Step to wait for, by its label", () => {
    expect(linkChoices(stock, "s-simmer")).toEqual([
      { id: "s-roast", label: "Step 1 · Roast the bones" },
      { id: "s-strain", label: "Step 3 · Strain and cool" },
    ]);
  });

  it("lists what a Step waits for by the before Step's label, and nothing for the others", () => {
    expect(waitsFor(stock, "s-strain")).toEqual([
      { id: "d-1", label: "Step 1 · Roast the bones" },
      { id: "d-2", label: "Step 2 · Simmer for four hours" },
    ]);
    expect(waitsFor(stock, "s-roast")).toEqual([]);
  });
});

describe("Planning pass saves", () => {
  it("sets a Step's times with a Revision id", () => {
    const args = { stepId: "s-roast", activeMinutes: 20, passiveMinutes: null };
    expect(stepTimesSave(args, createIntent())).toEqual({
      id: anId,
      name: "setStepTimes",
      args: { revisionId: anId, ...args },
    });
  });

  it("sets or clears a make-ahead window on the Recipe or a Step", () => {
    const intent = createIntent();
    const onRecipe = {
      target: { kind: "recipe", recipeId: "r-stock" },
      window: stockWindow,
    } as const;
    expect(makeAheadSave(onRecipe, intent)).toEqual({
      id: anId,
      name: "setMakeAhead",
      args: { revisionId: anId, ...onRecipe },
    });
    const cleared = { target: { kind: "step", stepId: "s-roast" }, window: null } as const;
    expect(makeAheadSave(cleared, intent).args).toEqual({ revisionId: anId, ...cleared });
  });

  it("groups a Step with the previous one", () => {
    expect(groupSave({ stepId: "s-simmer", value: true }, createIntent())).toEqual({
      id: anId,
      name: "setGroupWithPrevious",
      args: { revisionId: anId, stepId: "s-simmer", value: true },
    });
  });

  it("adds a link with a new link id", () => {
    const args = { beforeStepId: "s-roast", afterStepId: "s-strain" };
    const call = addLinkSave(args, createIntent());
    expect(call).toEqual({
      id: anId,
      name: "addStepDependency",
      args: { revisionId: anId, dependencyId: anId, ...args },
    });
    const { id, args: sent } = call as { id: string; args: Record<string, string> };
    expect(new Set([id, sent.revisionId, sent.dependencyId]).size).toBe(3);
  });

  it("removes a link by its id", () => {
    expect(removeLinkSave("d-1", createIntent())).toEqual({
      id: anId,
      name: "removeStepDependency",
      args: { revisionId: anId, dependencyId: "d-1" },
    });
  });

  it("keeps a save's ids for a retry of it, and starts new ids for another save", () => {
    const intent = createIntent();
    const args = { stepId: "s-roast", activeMinutes: 20, passiveMinutes: 60 };
    const first = stepTimesSave(args, intent);
    expect(stepTimesSave(args, intent)).toEqual(first);
    const other = stepTimesSave({ ...args, passiveMinutes: 90 }, intent);
    expect(other.id).not.toBe(first.id);
    expect(other.args.revisionId).not.toBe(first.args.revisionId);
    // A save of another kind is another save too.
    const link = removeLinkSave("d-1", intent);
    expect(removeLinkSave("d-1", intent)).toEqual(link);
    expect(groupSave({ stepId: "s-roast", value: true }, intent).id).not.toBe(link.id);
  });

  it("keeps a link's id for a retry, and starts a new one after a reset", () => {
    const intent = createIntent();
    const args = { beforeStepId: "s-roast", afterStepId: "s-strain" };
    const first = addLinkSave(args, intent);
    expect(addLinkSave(args, intent)).toEqual(first);
    intent.reset();
    expect(addLinkSave(args, intent).args.dependencyId).not.toBe(first.args.dependencyId);
  });
});
