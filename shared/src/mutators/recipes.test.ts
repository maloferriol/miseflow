import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { recipeRevisions, recipes } from "../schema.ts";
import { getMutator } from "./registry.ts";

const ownerId = crypto.randomUUID();

describe("createRecipe", () => {
  it("writes the Recipe at latest_revision 1 and Revision 1 with a jsonb snapshot", async () => {
    const recipeId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    await inRollback(async (tx) => {
      const mutator = getMutator("createRecipe")!;
      await mutator.run(tx, mutator.args.parse({ recipeId, revisionId, name: "Velouté", servings: 4 }), {
        ownerId,
      });

      const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, recipeId));
      expect(recipe).toMatchObject({ name: "Velouté", latestRevision: 1, ownerId });
      const revisions = await tx
        .select()
        .from(recipeRevisions)
        .where(eq(recipeRevisions.recipeId, recipeId));
      expect(revisions).toEqual([
        expect.objectContaining({
          id: revisionId,
          number: 1,
          ownerId,
          snapshot: { name: "Velouté", servings: 4 },
        }),
      ]);
    });
  });

  it("accepts a Recipe with only a name", () => {
    const args = getMutator("createRecipe")!.args;
    const parsed = args.safeParse({
      recipeId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      name: "Velouté",
    });
    expect(parsed.success).toBe(true);
  });
});
