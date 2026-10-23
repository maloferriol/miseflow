import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../mutators/define.ts";
import { ingredientLines, recipes, stepDependencies, steps } from "../schema.ts";
import type { MakeAhead } from "./planning.ts";
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
  activeMinutes: number | null;
  passiveMinutes: number | null;
  /** The Step's own window; null inherits the Recipe's. */
  makeAhead: MakeAhead | null;
  groupWithPrevious: boolean;
};

/** A manual finish-to-start link: `beforeStepId` finishes before `afterStepId` starts. */
export type SnapshotDependency = {
  id: string;
  beforeStepId: string;
  afterStepId: string;
};

/** The whole working copy of a Recipe, as each Revision stores it (Decision 4). */
export type RecipeSnapshot = {
  name: string;
  servings: number | null;
  makeAhead: MakeAhead | null;
  steps: SnapshotStep[];
  dependencies: SnapshotDependency[];
};

const toNumber = (value: string | null) =>
  value === null ? null : Number(value);

// A window is both columns set; anything else reads as no window.
const toMakeAhead = (row: {
  makeAheadBeforeDays: number | null;
  shelfLifeDays: number | null;
}): MakeAhead | null =>
  row.makeAheadBeforeDays === null || row.shelfLifeDays === null
    ? null
    : { beforeDays: row.makeAheadBeforeDays, shelfLifeDays: row.shelfLifeDays };

/** The caller's live Recipe with its live Steps and lines, in position order. */
export async function loadRecipeSnapshot(
  tx: Tx,
  ownerId: string,
  recipeId: string,
): Promise<RecipeSnapshot> {
  const [recipe] = await tx
    .select({
      name: recipes.name,
      servings: recipes.servings,
      makeAheadBeforeDays: recipes.makeAheadBeforeDays,
      shelfLifeDays: recipes.shelfLifeDays,
    })
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
    .select({
      id: steps.id,
      position: steps.position,
      body: steps.body,
      activeMinutes: steps.activeMinutes,
      passiveMinutes: steps.passiveMinutes,
      makeAheadBeforeDays: steps.makeAheadBeforeDays,
      shelfLifeDays: steps.shelfLifeDays,
      groupWithPrevious: steps.groupWithPrevious,
    })
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
  // Live links between live Steps only, so a link to a removed Step never shows.
  const stepIds = new Set(stepRows.map((s) => s.id));
  const dependencyRows = await tx
    .select({
      id: stepDependencies.id,
      beforeStepId: stepDependencies.beforeStepId,
      afterStepId: stepDependencies.afterStepId,
    })
    .from(stepDependencies)
    .where(
      and(
        eq(stepDependencies.recipeId, recipeId),
        eq(stepDependencies.ownerId, ownerId),
        isNull(stepDependencies.deletedAt),
      ),
    )
    .orderBy(asc(stepDependencies.id));

  return {
    name: recipe.name,
    servings: toNumber(recipe.servings),
    makeAhead: toMakeAhead(recipe),
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
      activeMinutes: step.activeMinutes,
      passiveMinutes: step.passiveMinutes,
      makeAhead: toMakeAhead(step),
      groupWithPrevious: step.groupWithPrevious,
    })),
    dependencies: dependencyRows.filter(
      (d) => stepIds.has(d.beforeStepId) && stepIds.has(d.afterStepId),
    ),
  };
}
