import {
  deriveIngredientList,
  effectiveMakeAhead,
  loadCatalog,
  loadRecipeSnapshot,
  readyToPlan,
  recipes,
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
// fields: each Step's effective make-ahead window, the dependencies and ready to plan (#85 Q10).
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
          latestRevision: recipes.latestRevision,
        })
        .from(recipes)
        .where(
          and(eq(recipes.ownerId, c.get("ownerId")), isNull(recipes.deletedAt)),
        )
        .orderBy(asc(recipes.name), asc(recipes.id));
      return c.json(
        {
          recipes: rows.map((r) => ({
            ...r,
            servings: r.servings === null ? null : Number(r.servings),
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

      const [snapshot, catalog] = await Promise.all([
        loadRecipeSnapshot(db, ownerId, recipe.id),
        loadCatalog(db, ownerId),
      ]);
      const names = new Map(catalog.map((entry) => [entry.id, entry.name]));
      return c.json(
        {
          recipe: {
            id: recipe.id,
            name: snapshot.name,
            servings: snapshot.servings,
            makeAhead: snapshot.makeAhead,
            latestRevision: recipe.latestRevision,
            steps: snapshot.steps.map((step) => ({
              id: step.id,
              position: step.position,
              body: step.body,
              lines: step.lines.map(
                ({ ingredientId, position: _, ...line }) => ({
                  ...line,
                  ingredient:
                    ingredientId === null
                      ? null
                      : {
                          id: ingredientId,
                          name: names.get(ingredientId) ?? "",
                        },
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
