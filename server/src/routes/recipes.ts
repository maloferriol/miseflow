import {
  deriveIngredientList,
  effectiveMakeAhead,
  ingredientLines,
  isMissingSubRecipe,
  loadCatalog,
  loadRecipeSnapshot,
  readyToPlan,
  recipes,
  steps,
  type Tx,
} from "@miseflow/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../auth.ts";
import type { Db } from "../db.ts";
import { errorBody } from "../errors.ts";

const recipeIdParam = z.uuid();

export type RecipesRouteOptions = {
  /** Runs inside the read, after the ownership check. Tests inject one to race a write. */
  afterOwnershipCheck?: (tx: Tx) => Promise<void>;
};

// GET /recipes: the caller's live Recipes, by name (#83 Decision 8).
// GET /recipes/:recipeId: one Recipe's working copy, read like a Revision snapshot, with each
// line's Ingredient name and the derived ingredient list (Decision 9), plus the Planning pass
// fields: each Step's effective make-ahead window, the dependencies and ready to plan (#85 Q10),
// and sub-recipes (#84): the yield, who uses this Recipe, whether it needs a yield, and each
// line's sub-recipe or Missing sub-recipe.
// Chained, so the web app's hc<AppType> client gets the response types (Hono RPC).
// Source: https://hono.dev/docs/guides/rpc
export function recipesRoute(db: Db, { afterOwnershipCheck }: RecipesRouteOptions = {}) {
  return new Hono<AuthEnv>()
    .get("/", async (c) => {
      const rows = await db
        .select({
          id: recipes.id,
          name: recipes.name,
          servings: recipes.servings,
          yieldQuantity: recipes.yieldQuantity,
          yieldUnit: recipes.yieldUnit,
          latestRevision: recipes.latestRevision,
        })
        .from(recipes)
        .where(and(eq(recipes.ownerId, c.get("ownerId")), isNull(recipes.deletedAt)))
        .orderBy(asc(recipes.name), asc(recipes.id));
      return c.json(
        {
          recipes: rows.map(({ yieldQuantity, yieldUnit, ...r }) => ({
            ...r,
            servings: r.servings === null ? null : Number(r.servings),
            yield: toYield(yieldQuantity, yieldUnit),
          })),
        },
        200,
      );
    })
    .get("/:recipeId", async (c) => {
      const ownerId = c.get("ownerId");
      const recipeId = recipeIdParam.safeParse(c.req.param("recipeId"));
      // Every read sees one snapshot (#128): a Recipe that passes the check is still there for
      // the snapshot load, and the response agrees with itself.
      const read = recipeId.success
        ? await db.transaction(
            async (tx) => {
              const [recipe] = await tx
                .select({ id: recipes.id, latestRevision: recipes.latestRevision })
                .from(recipes)
                .where(
                  and(
                    eq(recipes.id, recipeId.data),
                    eq(recipes.ownerId, ownerId),
                    isNull(recipes.deletedAt),
                  ),
                );
              if (!recipe) return null;
              await afterOwnershipCheck?.(tx);

              const [snapshot, catalog, live, usedBy] = await Promise.all([
                loadRecipeSnapshot(tx, ownerId, recipe.id),
                loadCatalog(tx, ownerId),
                // The owner's live Recipes, which a line's sub-recipe must be one of.
                tx
                  .select({
                    id: recipes.id,
                    name: recipes.name,
                    yieldQuantity: recipes.yieldQuantity,
                    yieldUnit: recipes.yieldUnit,
                  })
                  .from(recipes)
                  .where(and(eq(recipes.ownerId, ownerId), isNull(recipes.deletedAt))),
                // The live Recipes with a live line using this one.
                tx
                  .selectDistinct({ id: recipes.id, name: recipes.name })
                  .from(ingredientLines)
                  .innerJoin(steps, eq(steps.id, ingredientLines.stepId))
                  .innerJoin(recipes, eq(recipes.id, steps.recipeId))
                  .where(
                    and(
                      eq(ingredientLines.subRecipeId, recipe.id),
                      eq(ingredientLines.ownerId, ownerId),
                      isNull(ingredientLines.deletedAt),
                      isNull(steps.deletedAt),
                      isNull(recipes.deletedAt),
                    ),
                  )
                  .orderBy(asc(recipes.name), asc(recipes.id)),
              ]);
              return { recipe, snapshot, catalog, live, usedBy };
            },
            { isolationLevel: "repeatable read", accessMode: "read only" },
          )
        : null;
      if (!read) return c.json(errorBody("NOT_FOUND", "Recipe not found"), 404);
      const { recipe, snapshot, catalog, live, usedBy } = read;
      const names = new Map(catalog.map((entry) => [entry.id, entry.name]));
      const liveRecipes = new Map(
        live.map((r) => [
          r.id,
          { id: r.id, name: r.name, yield: toYield(r.yieldQuantity, r.yieldUnit) },
        ]),
      );
      const liveIds = new Set(liveRecipes.keys());
      return c.json(
        {
          recipe: {
            id: recipe.id,
            name: snapshot.name,
            servings: snapshot.servings,
            yield: snapshot.yield,
            usedBy,
            // A Recipe used as a sub-recipe needs a yield (units spec §5).
            needsYield: usedBy.length > 0 && snapshot.yield === null,
            makeAhead: snapshot.makeAhead,
            latestRevision: recipe.latestRevision,
            steps: snapshot.steps.map((step) => ({
              id: step.id,
              position: step.position,
              body: step.body,
              lines: step.lines.map(({ ingredientId, subRecipeId, position: _, ...line }) => ({
                ...line,
                ingredient:
                  ingredientId === null
                    ? null
                    : {
                        id: ingredientId,
                        // A deleted Ingredient is gone from the catalog: name it by the line (#128).
                        name: names.get(ingredientId) ?? line.wording ?? "",
                      },
                subRecipe: subRecipeId === null ? null : (liveRecipes.get(subRecipeId) ?? null),
                missingSubRecipe: isMissingSubRecipe({ ingredientId, subRecipeId }, liveIds),
              })),
              activeMinutes: step.activeMinutes,
              passiveMinutes: step.passiveMinutes,
              makeAhead: step.makeAhead,
              effectiveMakeAhead: effectiveMakeAhead(step, snapshot),
              groupWithPrevious: step.groupWithPrevious,
            })),
            ingredients: deriveIngredientList(snapshot),
            dependencies: snapshot.dependencies,
            readyToPlan: readyToPlan(snapshot, names),
          },
        },
        200,
      );
    });
}

function toYield(quantity: string | null, unit: string | null) {
  return quantity === null ? null : { quantity: Number(quantity), unit };
}
