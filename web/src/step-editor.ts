// The Step editor's decisions (ADR 0011): pure functions the hook and the view pass through.
import { refName } from "@miseflow/shared/src/recipe/tokens.ts";
import type { CatalogIngredient, RecipeListItem } from "./api.ts";
import type { Target } from "./step-links.ts";

/**
 * Where the "@" picker opens after an edit, or null when it stays shut. Typing one "@" at the
 * start or after a non-word character opens it; `caret` is the textarea's caret after the edit.
 */
export function pickerOpensAt(previous: string, next: string, caret: number): number | null {
  const typedOneAt = next.length === previous.length + 1 && next[caret - 1] === "@";
  return typedOneAt && !/[\p{L}\p{N}_]/u.test(next[caret - 2] ?? "") ? caret - 1 : null;
}

/** What the picker hands back: an Ingredient, a Recipe as a sub-recipe, or the typed text on close. */
export type PickerChoice =
  | { ingredient: Pick<CatalogIngredient, "id" | "name"> }
  | { recipe: Pick<RecipeListItem, "id" | "name" | "yield"> }
  | { typed: string };

export type Inserted = {
  text: string;
  caret: number;
  /** The wording the pick links, and its target; absent when the picker closed without a pick. */
  link?: { wording: string; target: Target };
};

/**
 * Replaces the "@" at `at` with `@<inserted>` and places the caret. An Ingredient or a sub-recipe
 * without a yield gets `{}`, the caret inside; a sub-recipe with a yield gets `{%unit}`, the caret
 * before the "%" (Q4). A kitchen's own name may hold characters the shorthand can't ("Pepper
 * (black)"), so the wording is its `refName`, with a fallback when nothing is left.
 */
export function insertPick(text: string, at: number, pick: PickerChoice): Inserted {
  const write = (inserted: string, back: number) => ({
    text: text.slice(0, at) + "@" + inserted + text.slice(at + 1),
    caret: at + 1 + inserted.length - back,
  });
  if ("typed" in pick) return write(pick.typed, 0);
  if ("ingredient" in pick) {
    const wording = refName(pick.ingredient.name) || "ingredient";
    return {
      ...write(`${wording}{}`, 1),
      link: { wording, target: { ingredientId: pick.ingredient.id } },
    };
  }
  const wording = refName(pick.recipe.name) || "sub-recipe";
  const unit = pick.recipe.yield?.unit;
  const link = { wording, target: { subRecipeId: pick.recipe.id } };
  return unit
    ? { ...write(`${wording}{%${unit}}`, unit.length + 2), link }
    : { ...write(`${wording}{}`, 1), link };
}
