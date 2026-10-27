import { normaliseName } from "@miseflow/shared/src/catalog/match.ts";
import type { StepTextPart } from "@miseflow/shared/src/recipe/tokens.ts";
import type { Intent } from "./intent.ts";

export type Ref = Extract<StepTextPart, { type: "ref" }>;

/** What a line links to: one Ingredient, or one Recipe used as a sub-recipe (#84). */
export type Target = { ingredientId: string } | { subRecipeId: string };

/** A line the Step already has; a ref with the same wording keeps it. */
export type KeptLine = {
  id: string;
  wording: string | null;
  ingredient?: { id: string } | null;
  subRecipe?: { id: string } | null;
};

/** The catalog's answer for one ref name: Ingredients, and the kitchen's Recipes that match. */
export type Lookup<I, R> = (
  name: string,
) => Promise<{ ingredients: I[]; recipes: { entry: R; exact: boolean }[] }>;

/** A ref name that found no single exact match, with what the cook can link it to. */
export type Unlinked<I, R> = { name: string; amount: string; near: I[]; nearRecipes: R[] };

export type ResolvedRef = { ref: Ref; keptLineId?: string; target?: Target };

/**
 * Links each ref of a Step, in order: (1) an earlier line with the same wording keeps its id and
 * its link; (2) a link the cook already made (picked, chosen, or found on an earlier Save); (3) one
 * exact Ingredient and no exact Recipe, or one exact Recipe and no exact Ingredient, links on its
 * own (Q5); (4) anything else waits for the cook's link choice, in `missing`.
 *
 * `links` is keyed by normalised wording, so one wording links to one target per Step: two refs
 * whose wording normalises the same share it (owner decision, #127 F).
 */
export async function resolveStepLinks<
  I extends { id: string; exact: boolean },
  R extends { id: string },
>(
  parts: StepTextPart[],
  keptLines: KeptLine[],
  links: ReadonlyMap<string, Target>,
  lookup: Lookup<I, R>,
): Promise<{ refs: ResolvedRef[]; links: Map<string, Target>; missing: Unlinked<I, R>[] }> {
  const unused = [...keptLines];
  const kept = parts
    .filter((part): part is Ref => part.type === "ref")
    .map((ref) => {
      const index = unused.findIndex(
        (l) => normaliseName(l.wording ?? "") === normaliseName(ref.name),
      );
      const line = index >= 0 ? unused.splice(index, 1)[0] : undefined;
      // A Missing sub-recipe (no live target) counts as unlinked (Q9).
      const target: Target | undefined = line?.ingredient
        ? { ingredientId: line.ingredient.id }
        : line?.subRecipe
          ? { subRecipeId: line.subRecipe.id }
          : undefined;
      return { ref, keptLineId: line?.id, target };
    });

  const found = new Map(links);
  const missing: Unlinked<I, R>[] = [];
  for (const { ref, target } of kept) {
    const key = normaliseName(ref.name);
    if (target || found.has(key) || missing.some((m) => normaliseName(m.name) === key)) continue;
    const { ingredients, recipes } = await lookup(ref.name);
    const exact = ingredients.find((r) => r.exact);
    const exactRecipes = recipes.filter((h) => h.exact);
    if (exact && !exactRecipes.length) found.set(key, { ingredientId: exact.id });
    else if (!exact && exactRecipes.length === 1)
      found.set(key, { subRecipeId: exactRecipes[0].entry.id });
    else
      missing.push({
        name: ref.name,
        amount: ref.amount,
        // When several match exactly, every exact one is offered too.
        near: ingredients.filter((r) => !r.exact || exactRecipes.length > 0).slice(0, 5),
        nearRecipes: recipes.map((h) => h.entry),
      });
  }

  const refs = kept.map((r) => ({
    ...r,
    target: r.target ?? found.get(normaliseName(r.ref.name)),
  }));
  return { refs, links: found, missing };
}

/**
 * The retry intent's key for one Step save (see useIntent): the text and each ref's resolved
 * target, so re-linking a wording to another target is a new save, while a plain retry replays.
 */
export function stepIntentKey(text: string, refs: ResolvedRef[]) {
  return JSON.stringify([text, refs.map((r) => r.target ?? null)]);
}

/**
 * The body and lines of a Step save: a kept line keeps its id, a new one takes `newId`, and each
 * `line` token in the body points at its ref's line, in order. Every ref must have a target.
 */
export function stepSaveArgs(
  parts: StepTextPart[],
  refs: ResolvedRef[],
  newId: (name: string) => string,
) {
  const lines = refs.map(({ ref, keptLineId, target }, index) => ({
    lineId: keptLineId ?? newId(`line ${index}`),
    ...target!,
    amount: ref.amount,
    wording: ref.name,
    preparation: ref.preparation,
  }));
  const lineIds = lines.map((l) => l.lineId).values();
  const body = parts.map((part) =>
    part.type === "text" ? part : { type: "line" as const, lineId: lineIds.next().value! },
  );
  return { body, lines };
}

/** What the cook chose for one unlinked wording (Decision 5, #84 Q1). */
export type ChosenLink =
  | { action: "addAlias"; wording: string; ingredientId: string }
  | {
      action: "createIngredient";
      wording: string;
      name: string;
      preferredKind: string;
      shoppingCategoryId: string;
    }
  | { action: "createSubRecipe"; wording: string; name: string };

/**
 * The mutation for a chosen link, its ids from `intent` keyed on the whole choice: retrying the
 * same choice replays it, and a different choice (target, new name, kind or category) is new.
 */
export function linkChoiceMutation(
  intent: Intent,
  choice: ChosenLink,
): { id: string; name: ChosenLink["action"]; args: Record<string, string>; target: Target } {
  const key = JSON.stringify(choice);
  const id = (name: string) => intent.id(key, name);
  const mutation = { id: id("mutation"), name: choice.action };
  switch (choice.action) {
    case "addAlias":
      return {
        ...mutation,
        args: { aliasId: id("alias"), ingredientId: choice.ingredientId, name: choice.wording },
        target: { ingredientId: choice.ingredientId },
      };
    case "createIngredient": {
      const ingredientId = id("ingredient");
      const { name, preferredKind, shoppingCategoryId } = choice;
      return {
        ...mutation,
        args: { ingredientId, name, preferredKind, shoppingCategoryId },
        target: { ingredientId },
      };
    }
    case "createSubRecipe": {
      const recipeId = id("recipe");
      return {
        ...mutation,
        args: { recipeId, revisionId: id("revision"), name: choice.name },
        target: { subRecipeId: recipeId },
      };
    }
  }
}
