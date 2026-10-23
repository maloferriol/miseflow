import { describe, expect, it } from "vitest";
import { deriveIngredientList } from "./derive.ts";
import type { RecipeSnapshot, SnapshotLine } from "./snapshot.ts";

const line = (id: string, wording: string, quantity: number | null, unit: string | null): SnapshotLine => ({
  id,
  ingredientId: `ingredient-${wording}`,
  quantity,
  quantityMax: null,
  unit,
  wording,
  preparation: null,
  fixedQuantity: false,
  position: "a0",
});

describe("deriveIngredientList", () => {
  it("lists one item per line, in Step then line order, without summing", () => {
    const snapshot: RecipeSnapshot = {
      name: "Sauce",
      servings: null,
      steps: [
        { id: "s1", position: "a0", body: [], lines: [line("l1", "shallots", 2, null), line("l2", "butter", 30, "g")] },
        { id: "s2", position: "a1", body: [], lines: [line("l3", "butter", 10, "g")] },
      ],
    };
    expect(deriveIngredientList(snapshot).map((i) => [i.stepId, i.lineId, i.wording, i.quantity])).toEqual([
      ["s1", "l1", "shallots", 2],
      ["s1", "l2", "butter", 30],
      ["s2", "l3", "butter", 10],
    ]);
  });
});
