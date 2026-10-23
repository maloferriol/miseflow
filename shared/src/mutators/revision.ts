import { and, eq, isNull, sql } from "drizzle-orm";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import { recipeRevisions, recipes, steps } from "../schema.ts";
import { NotFoundError, type Tx } from "./define.ts";

// Every Recipe edit locks the Recipe first, so concurrent edits of one Recipe run one after
// another and each gets the next Revision number.
export async function lockRecipe(tx: Tx, ownerId: string, recipeId: string) {
  const [row] = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.id, recipeId),
        eq(recipes.ownerId, ownerId),
        isNull(recipes.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new NotFoundError("Recipe");
}

/** The caller's live Step, with its Recipe locked as `lockRecipe` does. */
export async function lockStep(tx: Tx, ownerId: string, stepId: string) {
  const find = () =>
    tx
      .select({ id: steps.id, recipeId: steps.recipeId })
      .from(steps)
      .where(
        and(
          eq(steps.id, stepId),
          eq(steps.ownerId, ownerId),
          isNull(steps.deletedAt),
        ),
      );
  const [step] = await find();
  if (!step) throw new NotFoundError("Step");
  await lockRecipe(tx, ownerId, step.recipeId);
  // Read again under the lock: a concurrent removeStep may have committed in between.
  const [locked] = await find();
  if (!locked) throw new NotFoundError("Step");
  return locked;
}

/** Bumps the Recipe's latest Revision and appends that Revision's whole-Recipe snapshot. */
export async function appendRevision(
  tx: Tx,
  ownerId: string,
  recipeId: string,
  revisionId: string,
) {
  const [recipe] = await tx
    .update(recipes)
    .set({
      latestRevision: sql`${recipes.latestRevision} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(recipes.id, recipeId), eq(recipes.ownerId, ownerId)))
    .returning({ latestRevision: recipes.latestRevision });
  if (!recipe) throw new NotFoundError("Recipe");
  await tx.insert(recipeRevisions).values({
    id: revisionId,
    ownerId,
    recipeId,
    number: recipe.latestRevision,
    snapshot: await loadRecipeSnapshot(tx, ownerId, recipeId),
  });
}
