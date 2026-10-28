// The Step editor's decisions (ADR 0011): pure functions the hook and the view pass through.
import { normaliseName } from "@miseflow/shared/src/catalog/match.ts";
import { UNITS_BY_KIND } from "@miseflow/shared/src/catalog/units.ts";
import { parseQuantity } from "@miseflow/shared/src/recipe/quantity.ts";
import { parseStepText, refName } from "@miseflow/shared/src/recipe/tokens.ts";
import type { CatalogIngredient, RecipeLine, RecipeListItem } from "./api.ts";
import type { Ref, Target } from "./step-links.ts";

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

/**
 * The links with `link` added under its wording's normalised name, so one wording links to one
 * target per Step; the same links when the picker closed without a pick. A new Map: React state.
 */
export function withLink(
  links: ReadonlyMap<string, Target>,
  link: { wording: string; target: Target } | undefined,
): Map<string, Target> {
  const next = new Map(links);
  return link ? next.set(normaliseName(link.wording), link.target) : next;
}

/**
 * The names left unmatched by the last Save that still block the next one: those the text still
 * holds as a ref and the cook hasn't linked. `links` is keyed by normalised ref name.
 */
export function blockingSave<U extends { name: string }>(
  unmatched: U[],
  links: ReadonlyMap<string, Target>,
  text: string,
): U[] {
  const refs = new Set(
    parseStepText(text)
      .filter((p): p is Ref => p.type === "ref")
      .map((r) => normaliseName(r.name)),
  );
  return unmatched.filter((u) => {
    const name = normaliseName(u.name);
    return !links.has(name) && refs.has(name);
  });
}

/** "2", "30 g", "2-3 clove", "a pinch". */
export function amountText(line: Pick<RecipeLine, "quantity" | "quantityMax" | "unit">) {
  const number =
    line.quantity === null
      ? ""
      : `${line.quantity}${line.quantityMax === null ? "" : `-${line.quantityMax}`}`;
  return [number, line.unit].filter(Boolean).join(" ");
}

/** Unrecognised units are stored raw (Decision 10) and flagged on the chip. */
export function unknownUnit(unit: string | null) {
  return unit !== null && parseQuantity(`1%${unit}`).tier === "unknown";
}

/** What a chip reads of its line. */
export type ChipLine = Pick<
  RecipeLine,
  | "wording"
  | "quantity"
  | "quantityMax"
  | "unit"
  | "preparation"
  | "fixedQuantity"
  | "subRecipe"
  | "missingSubRecipe"
>;

/** A line's chip in read mode: "shallots 2 clove · diced · fixed". */
export function chipText(line: ChipLine) {
  // A line whose sub-recipe MiseFlow can't find still shows, and editing it treats it as unlinked.
  if (line.missingSubRecipe) return `Missing sub-recipe: ${line.wording ?? ""}`;
  return [
    `${line.wording ?? ""} ${amountText(line)}`.trim(),
    line.preparation,
    line.fixedQuantity && "fixed",
    unknownUnit(line.unit) && "unknown unit",
    line.subRecipe && "sub-recipe",
    line.subRecipe && line.subRecipe.yield === null && "needs a yield",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Decision 7: a new Ingredient's kind of measure comes from the ref's braced amount ("200%g");
 * an Ingredient unit or a bare number counts, and a vague or unknown unit falls back to mass.
 */
export function newIngredientKind(amount: string) {
  const q = parseQuantity(amount);
  if (q.tier === "ingredient") return "count";
  if (q.tier === "fixed")
    return (UNITS_BY_KIND.volume as readonly string[]).includes(q.unit!) ? "volume" : "mass";
  return "mass";
}

/** A new sub-recipe's name, from the ref: "chicken stock" → "Chicken stock". */
export function subRecipeName(wording: string) {
  return wording.charAt(0).toUpperCase() + wording.slice(1);
}

/** The Shopping category a new Ingredient goes under until the cook picks one: Other. */
export function defaultShoppingCategory(categories: { id: string; name: string }[] | undefined) {
  return categories?.find((c) => c.name === "Other")?.id;
}

/**
 * One Save of the Step form around `save` (a `saveStep`): once the Step is saved, `refetch` the
 * Recipe and the Recipe list, then `done` closes the form. A failed save refetches too: the server
 * may hold it though the response was lost, and the next Save or Add Step must see that (#127 B).
 * A save that stopped because a name still waits for the cook (false) does neither.
 */
export async function settleStepSave(
  save: () => Promise<boolean>,
  refetch: () => Promise<void>,
  done: () => void,
): Promise<boolean> {
  let saved: boolean;
  try {
    saved = await save();
  } catch (error) {
    await refetch();
    throw error;
  }
  if (saved) {
    await refetch();
    done();
  }
  return saved;
}
