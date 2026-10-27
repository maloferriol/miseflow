import { and, asc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { replanAffected } from "../plan/replan.ts";
import { stepGroups } from "../recipe/planning.ts";
import { isValidQuantity, parseQuantity } from "../recipe/quantity.ts";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import {
  areConsecutive,
  findSubRecipeCycle,
  parseYield,
  type SubRecipeEdges,
  type Yield,
} from "../recipe/subrecipes.ts";
import { refName } from "../recipe/tokens.ts";
import { ingredientLines, recipeRevisions, recipes, stepDependencies, steps } from "../schema.ts";
import { defineMutator, InvalidArgsError, NotFoundError, type Tx } from "./define.ts";
import { positionAfter } from "./position.ts";
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

/** Sets or clears (null) the Quantity a Recipe makes, appending one Revision. */
export const setYield = defineMutator({
  name: "setYield",
  args: z.strictObject({
    recipeId: z.uuid(),
    revisionId: z.uuid(),
    yield: yieldText.nullable(),
  }),
  async run(tx, args, { ownerId }) {
    const value = args.yield === null ? null : readYield(args.yield);
    await lockRecipe(tx, ownerId, args.recipeId);
    await tx
      .update(recipes)
      .set({ ...yieldColumns(value), updatedAt: sql`now()` })
      .where(and(eq(recipes.id, args.recipeId), eq(recipes.ownerId, ownerId)));
    await appendRevision(tx, ownerId, args.recipeId, args.revisionId);
  },
});

/**
 * Moves consecutive Steps of a Recipe into a new sub-recipe, in one transaction: the Steps keep
 * their ids, positions, text and lines, and one new Step in their place holds a single line using
 * the sub-recipe (Q3). Dependency links inside the moved Steps move with them, links crossing out
 * are soft-deleted, and a group the extract splits is cleared (Q11). Both Recipes get a Revision.
 */
export const extractToSubRecipe = defineMutator({
  name: "extractToSubRecipe",
  args: z.strictObject({
    recipeId: z.uuid(),
    revisionId: z.uuid(),
    stepIds: z.array(z.uuid()).min(1).max(200),
    subRecipeId: z.uuid(),
    subRecipeRevisionId: z.uuid(),
    name,
    /** The new Step left in place of the moved ones, and its one line. */
    stepId: z.uuid(),
    lineId: z.uuid(),
    amount: z
      .string()
      .max(100)
      .refine((amount) => isValidQuantity(parseQuantity(amount)), {
        message: "An amount can't divide by zero or have a range whose end is below its start",
      })
      .default("1"),
  }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    await lockRecipe(tx, ownerId, args.recipeId);
    await lockSubRecipeGraph(tx, ownerId);

    const live = await tx
      .select({
        id: steps.id,
        position: steps.position,
        groupWithPrevious: steps.groupWithPrevious,
      })
      .from(steps)
      .where(
        and(eq(steps.recipeId, args.recipeId), eq(steps.ownerId, ownerId), isNull(steps.deletedAt)),
      )
      .orderBy(asc(sql`${steps.position} collate "C"`), asc(steps.id));
    const moved = new Set(args.stepIds);
    if (![...moved].every((id) => live.some((s) => s.id === id))) throw new NotFoundError("Step");
    if (
      !areConsecutive(
        live.map((s) => s.id),
        [...moved],
      )
    )
      throw new InvalidArgsError("Only consecutive Steps can become a sub-recipe");
    const ids = [...moved];
    const first = live.find((s) => moved.has(s.id))!;

    // A group with Steps on both sides of the extract no longer holds together: clear it.
    const split = stepGroups(live).filter(
      (g) => g.stepIds.some((id) => moved.has(id)) && g.stepIds.some((id) => !moved.has(id)),
    );
    const ungrouped = split.flatMap((g) => g.stepIds);
    if (ungrouped.length)
      await tx
        .update(steps)
        .set({ groupWithPrevious: false, updatedAt: sql`now()` })
        .where(and(inArray(steps.id, ungrouped), eq(steps.groupWithPrevious, true)));

    const touching = and(
      eq(stepDependencies.recipeId, args.recipeId),
      eq(stepDependencies.ownerId, ownerId),
      isNull(stepDependencies.deletedAt),
    );
    await tx
      .update(stepDependencies)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          touching,
          or(
            and(
              inArray(stepDependencies.beforeStepId, ids),
              notInArray(stepDependencies.afterStepId, ids),
            ),
            and(
              inArray(stepDependencies.afterStepId, ids),
              notInArray(stepDependencies.beforeStepId, ids),
            ),
          ),
        ),
      );

    await tx.insert(recipes).values({
      id: args.subRecipeId,
      ownerId,
      name: args.name,
      latestRevision: 1,
    });
    await tx
      .update(stepDependencies)
      .set({ recipeId: args.subRecipeId, updatedAt: sql`now()` })
      .where(
        and(
          touching,
          inArray(stepDependencies.beforeStepId, ids),
          inArray(stepDependencies.afterStepId, ids),
        ),
      );
    await tx
      .update(steps)
      .set({ recipeId: args.subRecipeId, updatedAt: sql`now()` })
      .where(inArray(steps.id, ids));

    await tx.insert(steps).values({
      id: args.stepId,
      ownerId,
      recipeId: args.recipeId,
      position: first.position,
      body: [{ type: "line", lineId: args.lineId }],
    });
    const q = parseQuantity(args.amount);
    await tx.insert(ingredientLines).values({
      id: args.lineId,
      ownerId,
      stepId: args.stepId,
      subRecipeId: args.subRecipeId,
      quantity: q.value === null ? null : String(q.value),
      quantityMax: q.max === null ? null : String(q.max),
      unit: q.unit,
      wording: refName(args.name) || "sub-recipe",
      fixedQuantity: q.fixed,
      position: positionAfter(null),
    });

    await tx.insert(recipeRevisions).values({
      id: args.subRecipeRevisionId,
      ownerId,
      recipeId: args.subRecipeId,
      number: 1,
      snapshot: await loadRecipeSnapshot(tx, ownerId, args.subRecipeId),
    });
    await appendRevision(tx, ownerId, args.recipeId, args.revisionId);
    await replanAffected(tx, ctx, { recipeId: args.recipeId });
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
export async function loadSubRecipeGraph(tx: Tx, ownerId: string): Promise<SubRecipeEdges> {
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
      and(inArray(recipes.id, wanted), eq(recipes.ownerId, ownerId), isNull(recipes.deletedAt)),
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
