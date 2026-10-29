// The Ingredient catalog's decisions (ADR 0011): pure functions the hooks and the views pass through.
import type { CatalogIngredient } from "./api.ts";

/** A name field's text, trimmed, or null when it is blank. */
export function nameInput(text: string): string | null {
  return text.trim() || null;
}

/** What the New Ingredient form saves. */
export type NewIngredientInput = {
  name: string;
  preferredKind: string;
  shoppingCategoryId: string;
};

/** The New Ingredient form's fields as what to save, or null when the name is blank. */
export function newIngredientInput(
  name: string,
  preferredKind: string,
  shoppingCategoryId: string,
): NewIngredientInput | null {
  const trimmed = nameInput(name);
  return trimmed ? { name: trimmed, preferredKind, shoppingCategoryId } : null;
}

/**
 * What the catalog says after an Ingredient's name: its Shopping category, its Main unit (or the
 * kitchen's unit for its kind of measure), whether it is the kitchen's own, and its aliases.
 */
export function ingredientDetails(
  ingredient: Pick<
    CatalogIngredient,
    "shoppingCategory" | "mainUnit" | "preferredKind" | "source" | "aliases"
  >,
): string {
  const category = ingredient.shoppingCategory?.name ?? "No category";
  const unit = ingredient.mainUnit ?? `kitchen ${ingredient.preferredKind ?? ""} unit`;
  const yours = ingredient.source === "own" ? " · yours" : "";
  const aliases = ingredient.aliases.length > 0 ? ` · also: ${ingredient.aliases.join(", ")}` : "";
  return `${category} · ${unit}${yours}${aliases}`;
}
