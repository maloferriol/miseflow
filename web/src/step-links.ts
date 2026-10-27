import { normaliseName, searchCatalog } from "@miseflow/shared/src/catalog/match.ts";
import { parseStepText, type StepTextPart } from "@miseflow/shared/src/recipe/tokens.ts";
import { createIntent, type Intent } from "./intent.ts";

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

// A Missing sub-recipe (no live target) counts as unlinked (Q9).
function keptTarget(line: KeptLine): Target | undefined {
  if (line.ingredient) return { ingredientId: line.ingredient.id };
  if (line.subRecipe) return { subRecipeId: line.subRecipe.id };
  return undefined;
}

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
      return { ref, keptLineId: line?.id, target: line && keptTarget(line) };
    });

  // Each wording that still needs the catalog, once, in order; looked up in parallel.
  const asking = new Map<string, Ref>();
  for (const { ref, target } of kept) {
    const key = normaliseName(ref.name);
    if (!target && !links.has(key) && !asking.has(key)) asking.set(key, ref);
  }
  const answers = await Promise.all([...asking.values()].map((ref) => lookup(ref.name)));

  const found = new Map(links);
  const missing: Unlinked<I, R>[] = [];
  for (const [index, [key, ref]] of [...asking].entries()) {
    const { ingredients, recipes } = answers[index];
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

/** Sends one mutation to `/mutate` (api.ts `mutate`); throws when it fails. */
export type Send = (id: string, name: string, args: Record<string, unknown>) => Promise<void>;

/**
 * The catalog the Step editor links against: Ingredients by name or alias, and the kitchen's
 * Recipes other than this one, loaded once per Save.
 */
export function catalogLookup<I, R extends { id: string; name: string }>(
  recipeId: string,
  loadRecipes: () => Promise<R[]>,
  findIngredients: (name: string) => Promise<I[]>,
) {
  // A promise, so lookups running in parallel share one load.
  let entries: Promise<(R & { source: "own"; aliases: [] })[]> | undefined;
  const lookup: Lookup<I, R & { source: "own"; aliases: [] }> = async (name) => {
    entries ??= loadRecipes().then((recipes) =>
      recipes
        .filter((r) => r.id !== recipeId)
        .map((r) => ({ ...r, source: "own" as const, aliases: [] as [] })),
    );
    const [ingredients, catalog] = await Promise.all([findIngredients(name), entries]);
    return { ingredients, recipes: searchCatalog(catalog, name, 5) };
  };
  return lookup;
}

/**
 * Sends a resolved Step: `addStep`, or `editStep` for a Step the form opened. Its ids come from
 * `intent`, keyed after resolution, so linking a wording to another target is a new save while a
 * plain retry replays (#127 A). The slot resets once the save goes through.
 */
export async function sendStepSave(save: {
  recipeId: string;
  stepId: string;
  editing?: boolean;
  text: string;
  parts: StepTextPart[];
  refs: ResolvedRef[];
  intent: Intent;
  send: Send;
}) {
  const key = stepIntentKey(save.text, save.refs);
  const id = (name: string) => save.intent.id(key, name);
  const args = {
    stepId: save.stepId,
    revisionId: id("revision"),
    ...stepSaveArgs(save.parts, save.refs, id),
  };
  if (save.editing) await save.send(id("mutation"), "editStep", args);
  else await save.send(id("mutation"), "addStep", { recipeId: save.recipeId, ...args });
  save.intent.reset();
}

/**
 * One Save of the Step form: resolves the text's refs against the opened Step's lines, the links
 * and the catalog, hands the links and missing names to `onResolved`, then sends the Step once
 * every ref is linked. False when a name still waits for the cook.
 */
export async function saveStep<
  I extends { id: string; exact: boolean },
  R extends { id: string; name: string },
>(save: {
  recipeId: string;
  stepId: string;
  /** The Step as the form opened it; undefined for a new Step. */
  opened?: { lines: KeptLine[] };
  text: string;
  links: ReadonlyMap<string, Target>;
  loadRecipes: () => Promise<R[]>;
  findIngredients: (name: string) => Promise<I[]>;
  intent: Intent;
  send: Send;
  onResolved: (links: Map<string, Target>, missing: Unlinked<I, R>[]) => void;
}) {
  const parts = parseStepText(save.text);
  const lookup = catalogLookup(save.recipeId, save.loadRecipes, save.findIngredients);
  const resolved = await resolveStepLinks(parts, save.opened?.lines ?? [], save.links, lookup);
  save.onResolved(resolved.links, resolved.missing);
  if (resolved.missing.length) return false;
  await sendStepSave({ ...save, editing: !!save.opened, parts, refs: resolved.refs });
  return true;
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

/** Sends a chosen link (see `linkChoiceMutation`) and returns the target to link the wording to. */
export async function sendLinkChoice(intent: Intent, choice: ChosenLink, send: Send) {
  const { id, name, args, target } = linkChoiceMutation(intent, choice);
  await send(id, name, args);
  intent.reset();
  return target;
}

/**
 * The link choices for one unlinked wording, each action with its own retry intent, so one
 * going through doesn't drop another's pending ids (#127 D).
 */
export function linkChoices(wording: string, send: Send) {
  const alias = createIntent();
  const ingredient = createIntent();
  const subRecipe = createIntent();
  return {
    /** A near match teaches `wording` as its alias; an exact one, offered because a Recipe matches too, needs none. */
    useNearMatch: (match: { id: string; exact: boolean }): Promise<Target> =>
      match.exact
        ? Promise.resolve({ ingredientId: match.id })
        : sendLinkChoice(alias, { action: "addAlias", wording, ingredientId: match.id }, send),
    createIngredient: (args: { name: string; preferredKind: string; shoppingCategoryId: string }) =>
      sendLinkChoice(ingredient, { action: "createIngredient", wording, ...args }, send),
    createSubRecipe: (name: string) =>
      sendLinkChoice(subRecipe, { action: "createSubRecipe", wording, name }, send),
  };
}
