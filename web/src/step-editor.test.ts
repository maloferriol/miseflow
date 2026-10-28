import { describe, expect, it } from "vitest";
import { blockingSave, insertPick, pickerOpensAt } from "./step-editor.ts";

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
