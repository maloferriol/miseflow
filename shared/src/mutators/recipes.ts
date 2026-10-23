import { z } from "zod";
import { recipeRevisions, recipes } from "../schema.ts";
import { defineMutator } from "./define.ts";

export const createRecipe = defineMutator({
  name: "createRecipe",
  args: z.strictObject({
    recipeId: z.uuid(),
    // Browser-made like every id, so a replay writes the same Revision row.
    revisionId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    servings: z.number().positive().max(10_000).optional(),
  }),
  async run(tx, args, { ownerId }) {
    const servings = args.servings ?? null;
    await tx.insert(recipes).values({
      id: args.recipeId,
      ownerId,
      name: args.name,
      servings: servings === null ? null : String(servings),
      latestRevision: 1,
    });
    // Every Recipe edit appends a whole-Recipe snapshot in the same transaction (ADR 0010).
    await tx.insert(recipeRevisions).values({
      id: args.revisionId,
      ownerId,
      recipeId: args.recipeId,
      number: 1,
      snapshot: { name: args.name, servings },
    });
  },
});
