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
} from "@miseflow/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../auth.ts";
import type { Db } from "../db.ts";
import { errorBody } from "../errors.ts";

const recipeIdParam = z.uuid();

// GET /recipes: the caller's live Recipes, by name (#83 Decision 8).
// GET /recipes/:recipeId: one Recipe's working copy, read like a Revision snapshot, with each
// line's Ingredient name and the derived ingredient list (Decision 9), plus the Planning pass
// fields: each Step's effective make-ahead window, the dependencies and ready to plan (#85 Q10),
// and sub-recipes (#84): the yield, who uses this Recipe, whether it needs a yield, and each
// line's sub-recipe or Missing sub-recipe.
// Chained, so the web app's hc<AppType> client gets the response types (Hono RPC).
// Source: https://hono.dev/docs/guides/rpc
export function recipesRoute(db: Db) {
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
        .where(
          and(eq(recipes.ownerId, c.get("ownerId")), isNull(recipes.deletedAt)),
        )
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
      const [recipe] = recipeId.success
        ? await db
            .select({ id: recipes.id, latestRevision: recipes.latestRevision })
            .from(recipes)
            .where(
              and(
                eq(recipes.id, recipeId.data),
                eq(recipes.ownerId, ownerId),
                isNull(recipes.deletedAt),
              ),
            )
        : [];
      if (!recipe)
        return c.json(errorBody("NOT_FOUND", "Recipe not found"), 404);

      const [snapshot, catalog, live, usedBy] = await Promise.all([
        loadRecipeSnapshot(db, ownerId, recipe.id),
        loadCatalog(db, ownerId),
        // The owner's live Recipes, which a line's sub-recipe must be one of.
        db
          .select({
            id: recipes.id,
            name: recipes.name,
            yieldQuantity: recipes.yieldQuantity,
            yieldUnit: recipes.yieldUnit,
          })
          .from(recipes)
          .where(and(eq(recipes.ownerId, ownerId), isNull(recipes.deletedAt))),
        // The live Recipes with a live line using this one.
        db
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
              lines: step.lines.map(
                ({ ingredientId, subRecipeId, position: _, ...line }) => ({
                  ...line,
                  ingredient:
                    ingredientId === null
                      ? null
                      : {
                          id: ingredientId,
                          name: names.get(ingredientId) ?? "",
                        },
                  subRecipe:
                    subRecipeId === null
                      ? null
                      : (liveRecipes.get(subRecipeId) ?? null),
                  missingSubRecipe: isMissingSubRecipe(
                    { ingredientId, subRecipeId },
                    liveIds,
                  ),
                }),
              ),
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
