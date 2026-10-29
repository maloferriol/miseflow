// Recipes as GET /recipes/:id returned them in a real run against the local stack, from ADR
// 0004's walkthrough: the Tarte tatin before its pastry is extracted, and the Chicken stock
// Velouté uses, before and after its yield. Only the ids are shortened.
import type { Recipe, RecipeStep } from "../src/api.ts";

const rub: RecipeStep = {
  id: "s-rub",
  position: "a0",
  body: [
    { text: "Rub ", type: "text" },
    { type: "line", lineId: "l-butter" },
    { text: " into ", type: "text" },
    { type: "line", lineId: "l-flour" },
  ],
  lines: [
    {
      id: "l-butter",
      quantity: 100,
      quantityMax: null,
      unit: "g",
      wording: "butter",
      preparation: "cold, diced",
      fixedQuantity: false,
      ingredient: { id: "i-butter", name: "butter" },
      subRecipe: null,
      missingSubRecipe: false,
    },
    {
      id: "l-flour",
      quantity: 200,
      quantityMax: null,
      unit: "g",
      wording: "flour",
      preparation: null,
      fixedQuantity: false,
      ingredient: { id: "i-flour", name: "all-purpose flour" },
      subRecipe: null,
      missingSubRecipe: false,
    },
  ],
  activeMinutes: null,
  passiveMinutes: null,
  makeAhead: null,
  effectiveMakeAhead: null,
  groupWithPrevious: false,
};

const rest: RecipeStep = {
  id: "s-rest",
  position: "a1",
  body: [{ text: "Rest the pastry", type: "text" }],
  lines: [],
  activeMinutes: null,
  passiveMinutes: null,
  makeAhead: null,
  effectiveMakeAhead: null,
  groupWithPrevious: false,
};

const caramelise: RecipeStep = {
  id: "s-caramelise",
  position: "a2",
  body: [
    { text: "Caramelise ", type: "text" },
    { type: "line", lineId: "l-sugar" },
    { text: " and lay in ", type: "text" },
    { type: "line", lineId: "l-apples" },
  ],
  lines: [
    {
      id: "l-sugar",
      quantity: 150,
      quantityMax: null,
      unit: "g",
      wording: "sugar",
      preparation: null,
      fixedQuantity: false,
      ingredient: { id: "i-sugar", name: "sugar" },
      subRecipe: null,
      missingSubRecipe: false,
    },
    {
      id: "l-apples",
      quantity: 6,
      quantityMax: null,
      unit: null,
      wording: "apples",
      preparation: "halved",
      fixedQuantity: false,
      ingredient: { id: "i-apple", name: "apple" },
      subRecipe: null,
      missingSubRecipe: false,
    },
  ],
  activeMinutes: null,
  passiveMinutes: null,
  makeAhead: null,
  effectiveMakeAhead: null,
  groupWithPrevious: false,
};

/** Tarte tatin for 6: rub the pastry, rest it, caramelise the apples. */
export const tarteTatin: Recipe = {
  id: "r-tarte",
  name: "Tarte tatin",
  servings: 6,
  yield: null,
  usedBy: [],
  needsYield: false,
  makeAhead: null,
  latestRevision: 5,
  steps: [rub, rest, caramelise],
  ingredients: [
    {
      lineId: "l-butter",
      stepId: "s-rub",
      ingredientId: "i-butter",
      subRecipeId: null,
      wording: "butter",
      quantity: 100,
      quantityMax: null,
      unit: "g",
      preparation: "cold, diced",
      fixedQuantity: false,
    },
    {
      lineId: "l-flour",
      stepId: "s-rub",
      ingredientId: "i-flour",
      subRecipeId: null,
      wording: "flour",
      quantity: 200,
      quantityMax: null,
      unit: "g",
      preparation: null,
      fixedQuantity: false,
    },
    {
      lineId: "l-sugar",
      stepId: "s-caramelise",
      ingredientId: "i-sugar",
      subRecipeId: null,
      wording: "sugar",
      quantity: 150,
      quantityMax: null,
      unit: "g",
      preparation: null,
      fixedQuantity: false,
    },
    {
      lineId: "l-apples",
      stepId: "s-caramelise",
      ingredientId: "i-apple",
      subRecipeId: null,
      wording: "apples",
      quantity: 6,
      quantityMax: null,
      unit: null,
      preparation: "halved",
      fixedQuantity: false,
    },
  ],
  dependencies: [],
  readyToPlan: { missingDuration: ["s-rub", "s-rest", "s-caramelise"], duplicates: [] },
};

/** Chicken stock, used by Velouté and still without a yield. */
export const chickenStock: Recipe = {
  id: "r-stock",
  name: "Chicken stock",
  servings: null,
  yield: null,
  usedBy: [{ id: "r-veloute", name: "Velouté" }],
  needsYield: true,
  makeAhead: null,
  latestRevision: 1,
  steps: [],
  ingredients: [],
  dependencies: [],
  readyToPlan: { missingDuration: [], duplicates: [] },
};

/** The Chicken stock after setYield "1.5 L". */
export const chickenStockWithYield: Recipe = {
  ...chickenStock,
  yield: { quantity: 1.5, unit: "L" },
  needsYield: false,
  latestRevision: 2,
};

/** A Recipe after setYield "24": pieces, so no unit. */
export const yieldOf24: Recipe["yield"] = { quantity: 24, unit: null };
