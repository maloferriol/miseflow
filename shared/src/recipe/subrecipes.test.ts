import { describe, expect, it } from "vitest";
import {
  areConsecutive,
  findSubRecipeCycle,
  isMissingSubRecipe,
  parseYield,
} from "./subrecipes.ts";

const graph = (edges: [string, string[]][]) =>
  new Map(edges.map(([parent, children]) => [parent, new Set(children)]));

describe("findSubRecipeCycle", () => {
  it("finds the cycle when Velouté would use Beurre blanc, which already uses Velouté", () => {
    const edges = graph([["beurre-blanc", ["veloute"]]]);
    expect(findSubRecipeCycle(edges, "veloute", "beurre-blanc")).toEqual([
      "veloute",
      "beurre-blanc",
      "veloute",
    ]);
  });

  it("finds no cycle across a diamond", () => {
    const edges = graph([
      ["a", ["b", "c"]],
      ["b", ["c"]],
    ]);
    expect(findSubRecipeCycle(edges, "d", "c")).toBeNull();
    expect(findSubRecipeCycle(edges, "a", "c")).toBeNull();
  });

  it("refuses a self-link", () => {
    expect(findSubRecipeCycle(new Map(), "a", "a")).toEqual(["a", "a"]);
  });

  it("names a 3-cycle in order", () => {
    const edges = graph([
      ["b", ["c"]],
      ["c", ["a"]],
    ]);
    expect(findSubRecipeCycle(edges, "a", "b")).toEqual(["a", "b", "c", "a"]);
  });
});

describe("isMissingSubRecipe", () => {
  const live = new Set(["stock"]);
  it("is missing with no target", () => {
    expect(isMissingSubRecipe({ ingredientId: null, subRecipeId: null }, live)).toBe(true);
  });
  it("is missing when the target isn't a live Recipe", () => {
    expect(isMissingSubRecipe({ ingredientId: null, subRecipeId: "deleted" }, live)).toBe(true);
  });
  it("isn't missing when the target is live", () => {
    expect(isMissingSubRecipe({ ingredientId: null, subRecipeId: "stock" }, live)).toBe(false);
  });
  it("an Ingredient line is never missing", () => {
    expect(isMissingSubRecipe({ ingredientId: "butter", subRecipeId: null }, live)).toBe(false);
  });
});

describe("areConsecutive", () => {
  const ordered = ["1", "2", "3", "4"];
  it("is true for neighbours", () => expect(areConsecutive(ordered, ["3", "2"])).toBe(true));
  it("is false with a gap", () => expect(areConsecutive(ordered, ["1", "3"])).toBe(false));
  it("is false for none", () => expect(areConsecutive(ordered, [])).toBe(false));
  it("is false for an unknown id", () => expect(areConsecutive(ordered, ["2", "x"])).toBe(false));
});

describe("parseYield", () => {
  it("reads 1.5 L", () => expect(parseYield("1.5 L")).toEqual({ quantity: 1.5, unit: "L" }));
  it("reads 24 as pieces", () => expect(parseYield("24")).toEqual({ quantity: 24, unit: null }));
  it("reads the shorthand 500%g", () => expect(parseYield("500%g")).toEqual({ quantity: 500, unit: "g" }));
  it.each(["a pinch", "2-3", "=1 kg", "", "1/0", "0"])("refuses %j", (text) => {
    expect(() => parseYield(text)).toThrow();
  });
});
