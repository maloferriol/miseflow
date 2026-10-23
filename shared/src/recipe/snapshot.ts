import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../mutators/define.ts";
import { ingredientLines, recipes, steps } from "../schema.ts";
import type { StepToken } from "./tokens.ts";

export type SnapshotLine = {
  id: string;
  ingredientId: string | null;
  quantity: number | null;
  quantityMax: number | null;
  unit: string | null;
  wording: string | null;
  preparation: string | null;
  fixedQuantity: boolean;
  position: string;
};

export type SnapshotStep = {
  id: string;
  position: string;
  body: StepToken[];
  lines: SnapshotLine[];
};

/** The whole working copy of a Recipe, as each Revision stores it (Decision 4). */
export type RecipeSnapshot = {
  name: string;
  servings: number | null;
  steps: SnapshotStep[];
};

const toNumber = (value: string | null) =>
  value === null ? null : Number(value);

/** The caller's live Recipe with its live Steps and lines, in position order. */
export async function loadRecipeSnapshot(
  tx: Tx,
  ownerId: string,
  recipeId: string,
): Promise<RecipeSnapshot> {
  const [recipe] = await tx
    .select({ name: recipes.name, servings: recipes.servings })
    .from(recipes)
    .where(
      and(
        eq(recipes.id, recipeId),
        eq(recipes.ownerId, ownerId),
        isNull(recipes.deletedAt),
      ),
    );
  if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

  const stepRows = await tx
    .select({ id: steps.id, position: steps.position, body: steps.body })
    .from(steps)
    .where(
      and(
        eq(steps.recipeId, recipeId),
        eq(steps.ownerId, ownerId),
        isNull(steps.deletedAt),
      ),
    )
    .orderBy(asc(sql`${steps.position} collate "C"`), asc(steps.id));
  const lineRows = stepRows.length
    ? await tx
        .select()
        .from(ingredientLines)
        .where(
          and(
            inArray(
              ingredientLines.stepId,
              stepRows.map((s) => s.id),
            ),
            eq(ingredientLines.ownerId, ownerId),
            isNull(ingredientLines.deletedAt),
          ),
        )
        .orderBy(
          asc(sql`${ingredientLines.position} collate "C"`),
          asc(ingredientLines.id),
        )
    : [];

  return {
    name: recipe.name,
    servings: toNumber(recipe.servings),
    steps: stepRows.map((step) => ({
      id: step.id,
      position: step.position,
      body: step.body as StepToken[],
      lines: lineRows
        .filter((line) => line.stepId === step.id)
        .map((line) => ({
          id: line.id,
          ingredientId: line.ingredientId,
          quantity: toNumber(line.quantity),
          quantityMax: toNumber(line.quantityMax),
          unit: line.unit,
          wording: line.wording,
          preparation: line.preparation,
          fixedQuantity: line.fixedQuantity,
          position: line.position,
        })),
    })),
  };
}
