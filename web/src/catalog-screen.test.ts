import { describe, expect, it } from "vitest";
import { ingredientDetails, newIngredientInput } from "./catalog-screen.ts";

describe("newIngredientInput", () => {
  it("saves the trimmed name with the kind of measure and the Shopping category", () => {
    expect(newIngredientInput("  Chicken wings ", "mass", "cat-meat")).toEqual({
      name: "Chicken wings",
      preferredKind: "mass",
      shoppingCategoryId: "cat-meat",
    });
  });

  it("saves nothing when the name is blank", () => {
    expect(newIngredientInput("   ", "count", "cat-meat")).toBeNull();
  });
});

describe("ingredientDetails", () => {
  const seedOnion = {
    shoppingCategory: { id: "cat-veg", name: "Vegetables" },
    mainUnit: "g",
    preferredKind: "mass",
    source: "seed" as const,
    aliases: [],
  };

  it("names a seed Ingredient's Shopping category and Main unit", () => {
    expect(ingredientDetails(seedOnion)).toBe("Vegetables · g");
  });

  it("says No category when the Ingredient has none", () => {
    expect(ingredientDetails({ ...seedOnion, shoppingCategory: null })).toBe("No category · g");
  });

  it("names the kitchen's unit for the kind of measure when there is no Main unit", () => {
    expect(ingredientDetails({ ...seedOnion, mainUnit: null, preferredKind: "volume" })).toBe(
      "Vegetables · kitchen volume unit",
    );
  });

  it("leaves the kind out of the kitchen's unit when the Ingredient has no kind", () => {
    expect(ingredientDetails({ ...seedOnion, mainUnit: null, preferredKind: null })).toBe(
      "Vegetables · kitchen  unit",
    );
  });

  it("marks the kitchen's own Ingredient as yours, then lists its aliases", () => {
    expect(
      ingredientDetails({ ...seedOnion, source: "own", aliases: ["brown onion", "oignon"] }),
    ).toBe("Vegetables · g · yours · also: brown onion, oignon");
  });

  it("lists a seed Ingredient's aliases without marking it yours", () => {
    expect(ingredientDetails({ ...seedOnion, aliases: ["oignon"] })).toBe(
      "Vegetables · g · also: oignon",
    );
  });
});
