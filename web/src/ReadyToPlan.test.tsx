import { readyToPlan } from "@miseflow/shared/src/recipe/planning.ts";
import type {
  RecipeSnapshot,
  SnapshotLine,
  SnapshotStep,
} from "@miseflow/shared/src/recipe/snapshot.ts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderView } from "../test/render-view.tsx";
import { ReadyToPlan } from "./ReadyToPlan.tsx";

const line = (id: string, wording: string, preparation: string | null): SnapshotLine => ({
  id,
  ingredientId: null,
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
  activeMinutes: number | null,
  lines: SnapshotLine[] = [],
): SnapshotStep => ({
  id,
  position: "a0",
  body: [{ type: "text", text }, ...lines.map((l) => ({ type: "line" as const, lineId: l.id }))],
  lines,
  activeMinutes,
  passiveMinutes: null,
  makeAhead: null,
  groupWithPrevious: false,
});

// The props the Recipe read sends: the snapshot's Steps and `readyToPlan()` run on them.
function renderReadyToPlan(steps: SnapshotStep[]) {
  const snapshot: RecipeSnapshot = {
    name: "Sauce",
    servings: null,
    yield: null,
    makeAhead: null,
    steps,
    dependencies: [],
  };
  renderView(<ReadyToPlan recipe={{ steps, readyToPlan: readyToPlan(snapshot, new Map()) }} />);
}

describe("Ready to plan", () => {
  it("says every Step has a duration when nothing is missing", () => {
    renderReadyToPlan([step("s1", "Roast the bones", 10)]);
    expect(screen.getByText("Every Step has a duration")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("links a Step with no duration to its row in the Planning pass", () => {
    renderReadyToPlan([
      step("s1", "Roast the bones", 10),
      step("s2", "Simmer the stock for four hours, skimming often", null),
    ]);
    const link = screen.getByRole("link", {
      name: "Step 2 · Simmer the stock for four hours, skimmi… has no duration",
    });
    expect(link.getAttribute("href")).toBe("#plan-step-s2");
    expect(screen.queryByText("Every Step has a duration")).toBeNull();
  });

  it("links a likely duplicate to the Step that repeats the line's preparation", () => {
    renderReadyToPlan([
      step("s1", "Dice the shallots", 5),
      step("s2", "Sweat ", 10, [line("l1", "shallots", "diced")]),
    ]);
    const link = screen.getByRole("link", {
      name: "Step 1 · Dice the shallots may repeat 'shallots, diced'",
    });
    expect(link.getAttribute("href")).toBe("#plan-step-s1");
  });
});
