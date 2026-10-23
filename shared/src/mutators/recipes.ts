import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import { recipeRevisions, recipes } from "../schema.ts";
import { defineMutator } from "./define.ts";
import { appendRevision, lockRecipe } from "./revision.ts";

const name = z.string().trim().min(1).max(200);
const servings = z.number().positive().max(10_000);

export const createRecipe = defineMutator({
  name: "createRecipe",
  args: z.strictObject({
    recipeId: z.uuid(),
    // Browser-made like every id, so a replay writes the same Revision row.
    revisionId: z.uuid(),
    name,
    servings: servings.optional(),
  }),
  async run(tx, args, { ownerId }) {
    await tx.insert(recipes).values({
      id: args.recipeId,
      ownerId,
      name: args.name,
      servings: args.servings === undefined ? null : String(args.servings),
      latestRevision: 1,
    });
    // Every Recipe edit appends a whole-Recipe snapshot in the same transaction (ADR 0010).
    await tx.insert(recipeRevisions).values({
      id: args.revisionId,
      ownerId,
      recipeId: args.recipeId,
      number: 1,
      snapshot: await loadRecipeSnapshot(tx, ownerId, args.recipeId),
    });
  },
});

// Undefined leaves a field as it is; a null servings clears it.
export const editRecipe = defineMutator({
  name: "editRecipe",
  args: z
    .strictObject({
      recipeId: z.uuid(),
      revisionId: z.uuid(),
      name: name.optional(),
      servings: servings.nullable().optional(),
    })
    .refine((args) => args.name !== undefined || args.servings !== undefined, {
      message: "Give a name or servings",
    }),
  async run(tx, args, { ownerId }) {
    await lockRecipe(tx, ownerId, args.recipeId);
    await tx
      .update(recipes)
      .set({
        ...(args.name !== undefined && { name: args.name }),
        ...(args.servings !== undefined && {
          servings: args.servings === null ? null : String(args.servings),
        }),
        updatedAt: sql`now()`,
      })
      .where(and(eq(recipes.id, args.recipeId), eq(recipes.ownerId, ownerId)));
    await appendRevision(tx, ownerId, args.recipeId, args.revisionId);
  },
});
