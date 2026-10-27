import { describe, expect, it } from "vitest";
import { deriveIngredientList } from "./derive.ts";
import type { RecipeSnapshot, SnapshotLine } from "./snapshot.ts";

const line = (
  id: string,
  wording: string,
  quantity: number | null,
  unit: string | null,
): SnapshotLine => ({
  id,
  ingredientId: `ingredient-${wording}`,
  subRecipeId: null,
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
      yield: null,
      makeAhead: null,
      dependencies: [],
      steps: [
        {
          id: "s1",
          position: "a0",
          body: [],
          lines: [line("l1", "shallots", 2, null), line("l2", "butter", 30, "g")],
          activeMinutes: null,
          passiveMinutes: null,
          makeAhead: null,
          groupWithPrevious: false,
        },
        {
          id: "s2",
          position: "a1",
          body: [],
          lines: [
            line("l3", "butter", 10, "g"),
            { ...line("l4", "chicken stock", 1.5, "L"), ingredientId: null, subRecipeId: "stock" },
          ],
          activeMinutes: null,
          passiveMinutes: null,
          makeAhead: null,
          groupWithPrevious: false,
        },
      ],
    };
    expect(
      deriveIngredientList(snapshot).map((i) => [
        i.stepId,
        i.lineId,
        i.wording,
        i.quantity,
        i.subRecipeId,
      ]),
    ).toEqual([
      ["s1", "l1", "shallots", 2, null],
      ["s1", "l2", "butter", 30, null],
      ["s2", "l3", "butter", 10, null],
      ["s2", "l4", "chicken stock", 1.5, "stock"],
    ]);
  });
});
