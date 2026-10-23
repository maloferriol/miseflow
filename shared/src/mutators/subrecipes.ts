import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import {
  findSubRecipeCycle,
  parseYield,
  type SubRecipeEdges,
  type Yield,
} from "../recipe/subrecipes.ts";
import { ingredientLines, recipeRevisions, recipes, steps } from "../schema.ts";
import {
  defineMutator,
  InvalidArgsError,
  NotFoundError,
  type Tx,
} from "./define.ts";
import { appendRevision, lockRecipe } from "./revision.ts";

// Sub-recipes (units spec §5): a line can use another of the kitchen's Recipes instead of an
// Ingredient, a Recipe used that way needs a yield, and links never make a cycle.

const name = z.string().trim().min(1).max(200);
const yieldText = z.string().trim().min(1).max(100);

// The yield as the cook typed it, read through parseQuantity; anything else is refused.
function readYield(text: string): Yield {
  try {
    return parseYield(text);
  } catch (error) {
    throw new InvalidArgsError((error as Error).message);
  }
}

const yieldColumns = (value: Yield | null) => ({
  yieldQuantity: value === null ? null : String(value.quantity),
  yieldUnit: value?.unit ?? null,
});

/**
 * An empty Recipe at Revision 1, made from a line that names a sub-recipe the kitchen doesn't
 * have yet. The Step save then links the line to it by `subRecipeId` (Q1: two mutations).
 */
export const createSubRecipe = defineMutator({
  name: "createSubRecipe",
  args: z.strictObject({
    recipeId: z.uuid(),
    revisionId: z.uuid(),
    name,
    yield: yieldText.optional(),
  }),
  async run(tx, args, { ownerId }) {
    const value = args.yield === undefined ? null : readYield(args.yield);
    await tx.insert(recipes).values({
      id: args.recipeId,
      ownerId,
      name: args.name,
      ...yieldColumns(value),
      latestRevision: 1,
    });
    await tx.insert(recipeRevisions).values({
      id: args.revisionId,
      ownerId,
      recipeId: args.recipeId,
      number: 1,
      snapshot: await loadRecipeSnapshot(tx, ownerId, args.recipeId),
    });
  },
});

// One owner's sub-recipe links are written one transaction at a time, so two concurrent links
// can't each pass the cycle check and together close a cycle. A transaction-level advisory lock,
// keyed by a namespace and the owner id's first 32 bits; a collision only adds waiting.
// Source: https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
const SUB_RECIPE_LOCK = 84;
export async function lockSubRecipeGraph(tx: Tx, ownerId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SUB_RECIPE_LOCK}::int, ('x' || substr(replace(${ownerId}::text, '-', ''), 1, 8))::bit(32)::int)`,
  );
}

/** The owner's live sub-recipe links: live Recipe → live Step → live line → Recipe. */
export async function loadSubRecipeGraph(
  tx: Tx,
  ownerId: string,
): Promise<SubRecipeEdges> {
  const rows = await tx
    .select({ parent: steps.recipeId, child: ingredientLines.subRecipeId })
    .from(ingredientLines)
    .innerJoin(steps, eq(steps.id, ingredientLines.stepId))
    .innerJoin(recipes, eq(recipes.id, steps.recipeId))
    .where(
      and(
        eq(ingredientLines.ownerId, ownerId),
        isNotNull(ingredientLines.subRecipeId),
        isNull(ingredientLines.deletedAt),
        isNull(steps.deletedAt),
        isNull(recipes.deletedAt),
      ),
    );
  const edges: SubRecipeEdges = new Map();
  for (const { parent, child } of rows) {
    if (!edges.has(parent)) edges.set(parent, new Set());
    edges.get(parent)!.add(child!);
  }
  return edges;
}

/**
 * Checks that `parentId` may use each of `subRecipeIds`: each is the caller's live Recipe, and no
 * link closes a cycle. Takes the graph lock first; call it after locking the parent Recipe.
 */
export async function requireSubRecipeLinks(
  tx: Tx,
  ownerId: string,
  parentId: string,
  subRecipeIds: string[],
) {
  const wanted = [...new Set(subRecipeIds)];
  if (!wanted.length) return;
  await lockSubRecipeGraph(tx, ownerId);
  const rows = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        inArray(recipes.id, wanted),
        eq(recipes.ownerId, ownerId),
        isNull(recipes.deletedAt),
      ),
    );
  if (rows.length !== wanted.length) throw new NotFoundError("Recipe");

  const edges = await loadSubRecipeGraph(tx, ownerId);
  for (const childId of wanted) {
    const cycle = findSubRecipeCycle(edges, parentId, childId);
    if (!cycle) continue;
    const named = await tx
      .select({ id: recipes.id, name: recipes.name })
      .from(recipes)
      .where(and(inArray(recipes.id, cycle), eq(recipes.ownerId, ownerId)));
    const names = new Map(named.map((r) => [r.id, r.name]));
    throw new InvalidArgsError(
      `A sub-recipe can't use the Recipe it's in. This would make a cycle: ${cycle.map((id) => names.get(id)).join(" → ")}`,
    );
  }
}
