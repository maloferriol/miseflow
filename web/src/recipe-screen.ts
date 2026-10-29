// The Recipe screen's decisions (ADR 0011), with its yield field and Extract to sub-recipe: pure
// functions the hooks and the views pass through.
import { areConsecutive } from "@miseflow/shared/src/recipe/subrecipes.ts";
import type { Recipe, RecipeLine } from "./api.ts";
import type { Intent } from "./intent.ts";
import type { MutationCall } from "./mutation-call.ts";
import { amountText } from "./step-editor.ts";

/** Write (the Steps) or Plan (the Planning pass). */
export type Mode = "write" | "plan";

/** The mode a link opens on: Plan for `mode=plan`, else Write. */
export function modeFromSearch(search: string): Mode {
  return new URLSearchParams(search).get("mode") === "plan" ? "plan" : "write";
}

/** The link's query string with `mode` switched, so a reload stays in it (&mode=plan). */
export function searchWithMode(search: string, mode: Mode): string {
  const params = new URLSearchParams(search);
  if (mode === "plan") params.set("mode", "plan");
  else params.delete("mode");
  return `?${params}`;
}

/** The Recipe form's name and Servings as what to save, or null when the name is blank. */
export function recipeInput(
  name: string,
  servings: string,
): { name: string; servings: number | null } | null {
  const trimmedName = name.trim();
  const trimmedServings = servings.trim();
  if (!trimmedName) return null;
  return { name: trimmedName, servings: trimmedServings ? Number(trimmedServings) : null };
}

export type MoveArgs = { stepId: string; afterStepId: string | null };

/**
 * Where Move up and Move down put the Step at `index`: after the Step two above, or after the
 * Step below. Null when there is nowhere to go (the first Step up, the last Step down).
 */
export function stepMoves(
  stepIds: string[],
  index: number,
): { up: MoveArgs | null; down: MoveArgs | null } {
  const stepId = stepIds[index];
  return {
    up: index === 0 ? null : { stepId, afterStepId: stepIds[index - 2] ?? null },
    down: index === stepIds.length - 1 ? null : { stepId, afterStepId: stepIds[index + 1] },
  };
}

/** The ticked Steps after one is ticked or unticked. */
export function toggleSelection(selected: string[], stepId: string, checked: boolean): string[] {
  return checked ? [...selected, stepId] : selected.filter((id) => id !== stepId);
}

/** The ticked Steps that are still the Recipe's, so a removed Step doesn't stay ticked. */
export function liveSelection(stepIds: string[], selected: string[]): string[] {
  return selected.filter((id) => stepIds.includes(id));
}

/**
 * One row of the ingredient list: "2 clove shallots, diced", with the linked Ingredient's name
 * in brackets when the wording differs from it.
 */
export function ingredientText(
  item: Recipe["ingredients"][number],
  line: Pick<RecipeLine, "ingredient"> | undefined,
): string {
  let text = [amountText(item), item.wording].filter(Boolean).join(" ");
  if (item.preparation) text += `, ${item.preparation}`;
  if (line?.ingredient && line.ingredient.name !== item.wording) {
    text += ` (${line.ingredient.name})`;
  }
  return text;
}

/** A yield as the field shows it: "1.5 L", "24", or "" for none. */
export function yieldText(value: Recipe["yield"]): string {
  return value === null ? "" : [value.quantity, value.unit].filter((p) => p !== null).join(" ");
}

/** The yield field as what to save: the trimmed text, or null to clear it. */
export function yieldInput(text: string): string | null {
  return text.trim() || null;
}

/** Sets a Recipe's yield, with one set of ids per intended yield. */
export function yieldSave(
  recipeId: string,
  value: string | null,
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify(["setYield", value]);
  return {
    id: intent.id(key, "mutation"),
    name: "setYield",
    args: { recipeId, revisionId: intent.id(key, "revision"), yield: value },
  };
}

export type ExtractArgs = { stepIds: string[]; name: string; amount: string };

/**
 * What Extract to sub-recipe offers: whether the ticked Steps follow one another, and whether to
 * say they must (only once a Step is ticked).
 */
export function extractOffer(
  stepIds: string[],
  selected: string[],
): { consecutive: boolean; showHint: boolean } {
  const consecutive = areConsecutive(stepIds, selected);
  return { consecutive, showHint: selected.length > 0 && !consecutive };
}

/**
 * The extract to save, or null when it can't go: the ticked Steps don't follow one another, or
 * the name is blank. Steps go in Step order, so a retry of the same selection is the same
 * intent; a blank amount means 1.
 */
export function extractInput(
  stepIds: string[],
  selected: string[],
  name: string,
  amount: string,
): ExtractArgs | null {
  if (!areConsecutive(stepIds, selected) || !name.trim()) return null;
  return {
    stepIds: stepIds.filter((id) => selected.includes(id)),
    name: name.trim(),
    amount: amount.trim() || "1",
  };
}

/** Moves the Steps into a new sub-recipe; a retry of the same extract keeps its ids. */
export function extractSave(
  recipeId: string,
  args: ExtractArgs,
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify(["extractToSubRecipe", args]);
  const id = (what: string) => intent.id(key, what);
  return {
    id: id("mutation"),
    name: "extractToSubRecipe",
    args: {
      recipeId,
      revisionId: id("revision"),
      subRecipeId: id("subRecipe"),
      subRecipeRevisionId: id("subRecipeRevision"),
      stepId: id("step"),
      lineId: id("line"),
      ...args,
    },
  };
}
