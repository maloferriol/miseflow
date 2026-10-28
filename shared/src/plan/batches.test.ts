import { describe, expect, it } from "vitest";
import type { RecipeSnapshot, SnapshotLine } from "../recipe/snapshot.ts";
import { batchLabel, deriveBatches, formatFactor } from "./batches.ts";

const line = (
  subRecipeId: string | null,
  quantity: number | null,
  unit: string | null,
  o: { fixedQuantity?: boolean; max?: number } = {},
): SnapshotLine => ({
  id: crypto.randomUUID(),
  ingredientId: null,
  subRecipeId,
  quantity,
  quantityMax: o.max ?? null,
  unit,
  wording: subRecipeId,
  preparation: null,
  fixedQuantity: o.fixedQuantity ?? false,
  position: "a0",
});
const recipe = (
  name: string,
  o: {
    servings?: number;
    yield?: { quantity: number; unit: string | null };
    lines?: SnapshotLine[];
  },
): RecipeSnapshot => ({
  name,
  servings: o.servings ?? null,
  yield: o.yield ?? null,
  makeAhead: null,
  dependencies: [],
  steps: [
    {
      id: crypto.randomUUID(),
      position: "a0",
      body: [],
      lines: o.lines ?? [],
      activeMinutes: 10,
      passiveMinutes: null,
      makeAhead: null,
      groupWithPrevious: false,
    },
  ],
});
const dish = (dishId: string, recipeId: string, scaleFactor: number | null = null) => ({
  dishId,
  recipeId,
  scaleFactor,
});
const stock = () => recipe("Chicken stock", { yield: { quantity: 2, unit: "L" } });

describe("deriveBatches", () => {
  it("makes meringue ×1.2 for a Pavlova ×3 that uses 600 g of a meringue yielding 500 g", () => {
    const recipes = new Map([
      ["pavlova", recipe("Pavlova", { servings: 4, lines: [line("meringue", 200, "g")] })],
      ["meringue", recipe("Meringue", { yield: { quantity: 500, unit: "g" } })],
    ]);
    const { dishes, batches } = deriveBatches({
      guestCount: 12,
      region: "metric",
      recipes,
      dishes: [dish("d1", "pavlova")],
    });
    expect(dishes).toEqual([{ dishId: "d1", factor: 3, source: "guests", fixes: [] }]);
    expect(batches).toEqual([
      expect.objectContaining({
        subRecipeId: "meringue",
        factor: 1.2,
        scalable: true,
        fix: null,
        parents: [{ kind: "dish", id: "d1", name: "Pavlova" }],
      }),
    ]);
  });

  it("makes a stock yielding 2 L ×0.75 for a 1.5 L use", () => {
    const recipes = new Map([
      ["veloute", recipe("Velouté", { servings: 6, lines: [line("stock", 1.5, "L")] })],
      ["stock", stock()],
    ]);
    const { batches } = deriveBatches({
      guestCount: 6,
      region: "metric",
      recipes,
      dishes: [dish("d1", "veloute")],
    });
    expect(batches[0]).toMatchObject({ factor: 0.75, scalable: true });
  });

  it("counts a Fixed quantity line the same at any factor", () => {
    const recipes = new Map([
      [
        "veloute",
        recipe("Velouté", { servings: 6, lines: [line("stock", 1, "L", { fixedQuantity: true })] }),
      ],
      ["stock", stock()],
    ]);
    const factorWith = (guestCount: number, scaleFactor: number | null) =>
      deriveBatches({
        guestCount,
        region: "metric",
        recipes,
        dishes: [dish("d1", "veloute", scaleFactor)],
      }).batches[0].factor;
    expect(factorWith(6, null)).toBe(0.5);
    expect(factorWith(18, null)).toBe(0.5);
    expect(factorWith(6, 10)).toBe(0.5);
  });

  it("scales a chain of three sub-recipes recursively", () => {
    const recipes = new Map([
      ["dish", recipe("Dish", { servings: 3, lines: [line("a", 1, null)] })],
      ["a", recipe("A", { yield: { quantity: 1, unit: "kg" }, lines: [line("b", 300, "g")] })],
      ["b", recipe("B", { yield: { quantity: 200, unit: "g" }, lines: [line("c", 0.5, "L")] })],
      ["c", recipe("C", { yield: { quantity: 1, unit: "L" } })],
    ]);
    const { dishes, batches } = deriveBatches({
      guestCount: 6,
      region: "metric",
      recipes,
      dishes: [dish("d1", "dish")],
    });
    expect(dishes[0].factor).toBe(2);
    expect(batches.map((b) => [b.subRecipeId, b.factor])).toEqual([
      ["a", 2],
      ["b", 3],
      ["c", 1.5],
    ]);
    expect(batches.map((b) => b.parents)).toEqual([
      [{ kind: "dish", id: "d1", name: "Dish" }],
      [{ kind: "batch", id: "a", name: "A" }],
      [{ kind: "batch", id: "b", name: "B" }],
    ]);
  });

  it("gives two parents one Batch, its parents in Menu order", () => {
    const recipes = new Map([
      ["veloute", recipe("Velouté", { servings: 4, lines: [line("stock", 1.5, "L")] })],
      [
        "beurre",
        recipe("Beurre blanc", {
          yield: { quantity: 300, unit: "ml" },
          lines: [line("stock", 750, "ml")],
        }),
      ],
      ["duck", recipe("Duck", { servings: 6, lines: [line("beurre", 300, "ml")] })],
      ["stock", stock()],
    ]);
    const { batches } = deriveBatches({
      guestCount: 6,
      region: "metric",
      recipes,
      dishes: [dish("d1", "veloute"), dish("d2", "duck")],
    });
    expect(batches.map((b) => b.subRecipeId)).toEqual(["stock", "beurre"]);
    const stockBatch = batches[0];
    expect(stockBatch).toMatchObject({
      factor: 1.5,
      parents: [
        { kind: "dish", id: "d1", name: "Velouté" },
        { kind: "batch", id: "beurre", name: "Beurre blanc" },
      ],
    });
    expect(batchLabel(stockBatch)).toBe("Chicken stock ×1.5 · for: Velouté, Beurre blanc");
  });

  it("makes one Batch of a sub-recipe two others share in a diamond", () => {
    const recipes = new Map([
      ["dish", recipe("Dish", { servings: 6, lines: [line("b", 1, null), line("c", 1, null)] })],
      ["b", recipe("B", { yield: { quantity: 1, unit: "L" }, lines: [line("d", 100, "g")] })],
      ["c", recipe("C", { yield: { quantity: 1, unit: "L" }, lines: [line("d", 300, "g")] })],
      ["d", recipe("D", { yield: { quantity: 200, unit: "g" } })],
    ]);
    const { batches } = deriveBatches({
      guestCount: 6,
      region: "metric",
      recipes,
      dishes: [dish("d1", "dish")],
    });
    expect(batches.map((b) => b.subRecipeId)).toEqual(["b", "d", "c"]);
    expect(batches.find((b) => b.subRecipeId === "d")).toMatchObject({
      factor: 2,
      parents: [
        { kind: "batch", id: "b", name: "B" },
        { kind: "batch", id: "c", name: "C" },
      ],
    });
  });

  it("plans a sub-recipe with no yield as 1 batch, asks every Dish reaching it to add a yield, and scales its child from 1", () => {
    const recipes = new Map([
      ["veloute", recipe("Velouté", { servings: 2, lines: [line("roux", 100, "g")] })],
      ["gratin", recipe("Gratin", { servings: 2, lines: [line("sauce", 1, "L")] })],
      [
        "sauce",
        recipe("Sauce", { yield: { quantity: 1, unit: "L" }, lines: [line("roux", 50, "g")] }),
      ],
      ["roux", recipe("Roux", { lines: [line("butter", 100, "g")] })],
      ["butter", recipe("Clarified butter", { yield: { quantity: 200, unit: "g" } })],
    ]);
    const { dishes, batches } = deriveBatches({
      guestCount: 6,
      region: "metric",
      recipes,
      dishes: [dish("d1", "veloute"), dish("d2", "gratin")],
    });
    expect(batches.find((b) => b.subRecipeId === "roux")).toMatchObject({
      factor: 1,
      scalable: false,
      fix: "add a yield",
    });
    expect(batches.find((b) => b.subRecipeId === "butter")).toMatchObject({
      factor: 0.5,
      scalable: true,
    });
    const fix = { subRecipeId: "roux", subRecipeName: "Roux", text: "add a yield" };
    expect(dishes.map((d) => d.fixes)).toEqual([[fix], [fix]]);
  });

  it("asks for a yield in g when grams are used against a yield in L", () => {
    const recipes = new Map([
      ["veloute", recipe("Velouté", { servings: 6, lines: [line("stock", 500, "g")] })],
      ["stock", stock()],
    ]);
    const { dishes, batches } = deriveBatches({
      guestCount: 6,
      region: "metric",
      recipes,
      dishes: [dish("d1", "veloute")],
    });
    expect(batches[0]).toMatchObject({ factor: 1, scalable: false, fix: "add a yield in g" });
    expect(dishes[0].fixes).toEqual([
      { subRecipeId: "stock", subRecipeName: "Chicken stock", text: "add a yield in g" },
    ]);
  });

  it("skips a Missing sub-recipe", () => {
    const recipes = new Map([
      [
        "veloute",
        recipe("Velouté", { servings: 6, lines: [line("gone", 1, "L"), line(null, 1, "L")] }),
      ],
    ]);
    const { dishes, batches } = deriveBatches({
      guestCount: 6,
      region: "metric",
      recipes,
      dishes: [dish("d1", "veloute")],
    });
    expect(batches).toEqual([]);
    expect(dishes[0].fixes).toEqual([]);
  });

  it("counts a range at its upper end", () => {
    const recipes = new Map([
      ["veloute", recipe("Velouté", { servings: 6, lines: [line("stock", 1, "L", { max: 3 })] })],
      ["stock", stock()],
    ]);
    expect(
      deriveBatches({ guestCount: 6, region: "metric", recipes, dishes: [dish("d1", "veloute")] })
        .batches[0].factor,
    ).toBe(1.5);
  });

  it("reads %servings through the sub-recipe's servings", () => {
    const recipes = new Map([
      ["veloute", recipe("Velouté", { servings: 6, lines: [line("stock", 3, "servings")] })],
      ["stock", recipe("Chicken stock", { servings: 4, yield: { quantity: 2, unit: "L" } })],
    ]);
    expect(
      deriveBatches({ guestCount: 12, region: "metric", recipes, dishes: [dish("d1", "veloute")] })
        .batches[0].factor,
    ).toBe(1.5);
  });

  it("takes a set factor as is, and assumes ×1 with 'add servings' when a Recipe has no servings", () => {
    const recipes = new Map([
      ["veloute", recipe("Velouté", { servings: 4 })],
      ["bread", recipe("Bread", {})],
    ]);
    const { dishes } = deriveBatches({
      guestCount: 6,
      region: "metric",
      recipes,
      dishes: [dish("d1", "veloute", 2.5), dish("d2", "bread")],
    });
    expect(dishes).toEqual([
      { dishId: "d1", factor: 2.5, source: "set", fixes: [] },
      {
        dishId: "d2",
        factor: 1,
        source: "assumed",
        fixes: [{ subRecipeId: null, subRecipeName: null, text: "add servings" }],
      },
    ]);
  });
});

describe("batchLabel", () => {
  it("rounds the factor to 2 decimals", () => {
    expect(formatFactor(1.5)).toBe("×1.5");
    expect(formatFactor(0.75)).toBe("×0.75");
    expect(formatFactor(4 / 3)).toBe("×1.33");
    expect(
      batchLabel({
        subRecipeId: "s",
        name: "Chicken stock",
        factor: 1.5,
        scalable: true,
        fix: null,
        parents: [
          { kind: "dish", id: "d", name: "Velouté" },
          { kind: "batch", id: "b", name: "Beurre blanc" },
        ],
      }),
    ).toBe("Chicken stock ×1.5 · for: Velouté, Beurre blanc");
  });
});
