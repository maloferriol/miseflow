import { describe, expect, it } from "vitest";
import {
  amountText,
  blockingSave,
  chipText,
  type ChipLine,
  defaultShoppingCategory,
  insertPick,
  newIngredientKind,
  pickerOpensAt,
  settleStepSave,
  stepFormText,
  subRecipeName,
  unknownUnit,
  withLink,
} from "./step-editor.ts";

// The "@" the picker replaces sits at 5 in "Dice @ finely".
describe("insertPick", () => {
  it("writes an Ingredient's wording with empty braces, the caret inside them", () => {
    const picked = insertPick("Dice @ finely", 5, {
      ingredient: { id: "i-shallot", name: "Shallots" },
    });
    expect(picked).toEqual({
      text: "Dice @Shallots{} finely",
      caret: 15,
      link: { wording: "Shallots", target: { ingredientId: "i-shallot" } },
    });
    expect(picked.text.slice(0, picked.caret)).toBe("Dice @Shallots{");
  });

  it("words an Ingredient the shorthand can't hold, and falls back when nothing is left", () => {
    expect(insertPick("@", 0, { ingredient: { id: "i-pepper", name: "Pepper (black)" } })).toEqual({
      text: "@Pepper black{}",
      caret: 14,
      link: { wording: "Pepper black", target: { ingredientId: "i-pepper" } },
    });
    expect(insertPick("@", 0, { ingredient: { id: "i-odd", name: "(@)" } }).link?.wording).toBe(
      "ingredient",
    );
  });

  it("prefills a sub-recipe's yield unit, the caret before the %", () => {
    const picked = insertPick("Add @ to the pan", 4, {
      recipe: { id: "r-stock", name: "Chicken stock", yield: { quantity: 2, unit: "L" } },
    });
    expect(picked).toEqual({
      text: "Add @Chicken stock{%L} to the pan",
      caret: 19,
      link: { wording: "Chicken stock", target: { subRecipeId: "r-stock" } },
    });
    expect(picked.text.slice(0, picked.caret)).toBe("Add @Chicken stock{");
  });

  it("gives a sub-recipe without a yield empty braces", () => {
    expect(
      insertPick("Add @", 4, { recipe: { id: "r-sauce", name: "Sauce", yield: null } }),
    ).toEqual({
      text: "Add @Sauce{}",
      caret: 11,
      link: { wording: "Sauce", target: { subRecipeId: "r-sauce" } },
    });
    expect(insertPick("@", 0, { recipe: { id: "r-x", name: "()", yield: null } }).text).toBe(
      "@sub-recipe{}",
    );
  });

  it("puts typed text back after the @ when the picker closes, with nothing linked", () => {
    expect(insertPick("Dice @ finely", 5, { typed: "shal" })).toEqual({
      text: "Dice @shal finely",
      caret: 10,
    });
    expect(insertPick("Dice @ finely", 5, { typed: "" })).toEqual({
      text: "Dice @ finely",
      caret: 6,
    });
  });
});

// The caret sits just after what the cook typed, as `selectionStart` reports it.
describe("pickerOpensAt", () => {
  it("opens on an @ typed at the start", () => {
    expect(pickerOpensAt("", "@", 1)).toBe(0);
  });

  it("opens on an @ typed after a space or punctuation", () => {
    expect(pickerOpensAt("Dice ", "Dice @", 6)).toBe(5);
    expect(pickerOpensAt("Dice (", "Dice (@", 7)).toBe(6);
  });

  it("opens on an @ typed in the middle of the text", () => {
    expect(pickerOpensAt("Dice  finely", "Dice @ finely", 6)).toBe(5);
  });

  it("stays shut for an @ typed after a letter, a digit or an underscore", () => {
    expect(pickerOpensAt("cook", "cook@", 5)).toBeNull();
    expect(pickerOpensAt("café", "café@", 5)).toBeNull();
    expect(pickerOpensAt("2", "2@", 2)).toBeNull();
    expect(pickerOpensAt("a_", "a_@", 3)).toBeNull();
  });

  it("stays shut for a character other than @", () => {
    expect(pickerOpensAt("Dice ", "Dice a", 6)).toBeNull();
  });

  it("stays shut when an @ arrives with other text, as a paste does", () => {
    expect(pickerOpensAt("Dice ", "Dice @shallots", 14)).toBeNull();
    expect(pickerOpensAt("", "@@", 2)).toBeNull();
  });

  it("stays shut when text is deleted", () => {
    expect(pickerOpensAt("Dice @a", "Dice @", 6)).toBeNull();
  });
});

// What the last Save left unmatched: names with their near matches (none needed here).
const unmatched = (...names: string[]) =>
  names.map((name) => ({ name, amount: "", near: [], nearRecipes: [] }));

describe("blockingSave", () => {
  it("blocks Save on each unmatched name the text still holds", () => {
    expect(
      blockingSave(unmatched("shallots", "stock"), new Map(), "Dice @shallots{2} into @stock{}"),
    ).toEqual(unmatched("shallots", "stock"));
  });

  it("stops blocking on a name the cook has linked, whatever its case, plural or accents", () => {
    // Links are keyed by normalised name, as `normaliseName("Shallots")` gives it.
    const links = new Map([["shallot", { ingredientId: "i-shallot" }]]);
    expect(blockingSave(unmatched("Shallots", "stock"), links, "@Shallots{} @stock{}")).toEqual(
      unmatched("stock"),
    );
    expect(
      blockingSave(unmatched("puree"), new Map(), "Stir in @Purée{}").map((u) => u.name),
    ).toEqual(["puree"]);
  });

  it("stops blocking on a name the cook has taken out of the text", () => {
    expect(blockingSave(unmatched("shallots"), new Map(), "Dice the shallots")).toEqual([]);
  });

  it("blocks nothing before the first Save", () => {
    expect(blockingSave([], new Map(), "Dice @shallots{}")).toEqual([]);
  });
});

describe("stepFormText", () => {
  it("opens a new Step empty", () => {
    expect(stepFormText(undefined)).toBe("");
  });

  it("opens a saved Step as its shorthand, each line in place of its token", () => {
    const line = {
      id: "l-shallots",
      wording: "shallots",
      quantity: 2,
      quantityMax: null,
      unit: "clove",
      fixedQuantity: false,
      preparation: "diced",
    };
    const body = [
      { type: "text" as const, text: "Sweat " },
      { type: "line" as const, lineId: "l-shallots" },
      { type: "text" as const, text: " gently" },
    ];
    expect(stepFormText({ body, lines: [line] })).toBe("Sweat @shallots{2%clove}(diced) gently");
  });
});

describe("withLink", () => {
  it("links a wording to its target under the wording's normalised name", () => {
    const links = new Map([["stock", { subRecipeId: "r-stock" }]]);
    const next = withLink(links, { wording: "Shallots", target: { ingredientId: "i-shallot" } });
    expect([...next]).toEqual([
      ["stock", { subRecipeId: "r-stock" }],
      ["shallot", { ingredientId: "i-shallot" }],
    ]);
    expect([...links]).toEqual([["stock", { subRecipeId: "r-stock" }]]);
  });

  it("keeps the links as they are when the picker closed without a pick", () => {
    const links = new Map([["stock", { subRecipeId: "r-stock" }]]);
    expect([...withLink(links, undefined)]).toEqual([["stock", { subRecipeId: "r-stock" }]]);
  });
});

// The braced amount of a ref, as the cook typed it: `@shallots{2%clove}` gives "2%clove".
describe("newIngredientKind", () => {
  it("measures by mass for a mass unit and by volume for a volume unit", () => {
    expect(newIngredientKind("200%g")).toBe("mass");
    expect(newIngredientKind("=1%L")).toBe("volume");
    expect(newIngredientKind("2%tbsp")).toBe("volume");
  });

  it("counts an Ingredient unit or a bare number", () => {
    expect(newIngredientKind("2%clove")).toBe("count");
    expect(newIngredientKind("3")).toBe("count");
  });

  it("falls back to mass for a vague amount, an unknown unit or nothing", () => {
    expect(newIngredientKind("%pinch")).toBe("mass");
    expect(newIngredientKind("2%blob")).toBe("mass");
    expect(newIngredientKind("")).toBe("mass");
  });
});

describe("subRecipeName", () => {
  it("names a new sub-recipe after the ref, capitalised as a Recipe's name", () => {
    expect(subRecipeName("chicken stock")).toBe("Chicken stock");
    expect(subRecipeName("Demi-glace")).toBe("Demi-glace");
  });
});

describe("defaultShoppingCategory", () => {
  const categories = [
    { id: "c-veg", name: "Vegetables" },
    { id: "c-other", name: "Other" },
  ];

  it("files a new Ingredient under Other until the cook picks a category", () => {
    expect(defaultShoppingCategory(categories)).toBe("c-other");
  });

  it("has no default while the categories load, or when the kitchen has no Other", () => {
    expect(defaultShoppingCategory(undefined)).toBeUndefined();
    expect(defaultShoppingCategory([{ id: "c-veg", name: "Vegetables" }])).toBeUndefined();
  });
});

describe("amountText", () => {
  it("writes the number, a range and the unit", () => {
    expect(amountText({ quantity: 30, quantityMax: null, unit: "g" })).toBe("30 g");
    expect(amountText({ quantity: 2, quantityMax: 3, unit: "clove" })).toBe("2-3 clove");
    expect(amountText({ quantity: 2, quantityMax: null, unit: null })).toBe("2");
    expect(amountText({ quantity: null, quantityMax: null, unit: "a pinch" })).toBe("a pinch");
    expect(amountText({ quantity: null, quantityMax: null, unit: null })).toBe("");
  });
});

describe("unknownUnit", () => {
  it("flags a unit MiseFlow doesn't recognise, and nothing else", () => {
    expect(unknownUnit("blob")).toBe(true);
    expect(unknownUnit("g")).toBe(false);
    expect(unknownUnit("clove")).toBe(false);
    expect(unknownUnit("pinch")).toBe(false);
    expect(unknownUnit(null)).toBe(false);
  });
});

const chipLine = (line: Partial<ChipLine>): ChipLine => ({
  wording: "shallots",
  quantity: null,
  quantityMax: null,
  unit: null,
  preparation: null,
  fixedQuantity: false,
  subRecipe: null,
  missingSubRecipe: false,
  ...line,
});

describe("chipText", () => {
  it("shows the wording and amount, then the preparation and flags", () => {
    expect(chipText(chipLine({ quantity: 2, unit: "clove" }))).toBe("shallots 2 clove");
    expect(chipText(chipLine({ quantity: 2, preparation: "diced", fixedQuantity: true }))).toBe(
      "shallots 2 · diced · fixed",
    );
    expect(chipText(chipLine({ quantity: 1, unit: "blob" }))).toBe(
      "shallots 1 blob · unknown unit",
    );
  });

  it("marks a sub-recipe, and one that needs a yield", () => {
    const stock = { id: "r-stock", name: "Chicken stock" };
    expect(
      chipText(
        chipLine({
          wording: "stock",
          quantity: 0.5,
          unit: "L",
          subRecipe: { ...stock, yield: { quantity: 2, unit: "L" } },
        }),
      ),
    ).toBe("stock 0.5 L · sub-recipe");
    expect(chipText(chipLine({ wording: "stock", subRecipe: { ...stock, yield: null } }))).toBe(
      "stock · sub-recipe · needs a yield",
    );
  });

  it("names a sub-recipe MiseFlow can't find", () => {
    expect(chipText(chipLine({ wording: "stock", quantity: 1, missingSubRecipe: true }))).toBe(
      "Missing sub-recipe: stock",
    );
  });
});

// What one Save does after `saveStep`: `refetch` reloads the Recipe and the Recipe list.
describe("settleStepSave", () => {
  function track(save: () => Promise<boolean>) {
    const calls: string[] = [];
    const settled = settleStepSave(
      save,
      async () => void calls.push("refetch"),
      () => void calls.push("done"),
    );
    return { calls, settled };
  }

  it("refetches, then closes the form, once the Step is saved", async () => {
    const { calls, settled } = track(async () => true);
    await expect(settled).resolves.toBe(true);
    expect(calls).toEqual(["refetch", "done"]);
  });

  it("leaves the form open with nothing refetched while a name waits for the cook", async () => {
    const { calls, settled } = track(async () => false);
    await expect(settled).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("refetches after a failed save, which the server may hold, and keeps the form open", async () => {
    const { calls, settled } = track(async () => {
      throw new Error("Network down");
    });
    await expect(settled).rejects.toThrow("Network down");
    expect(calls).toEqual(["refetch"]);
  });
});
