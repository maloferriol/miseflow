import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import { recipeRevisions, recipes } from "../schema.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");

const ownerId = crypto.randomUUID();

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner, timeZone: "Europe/Paris", now: () => FIXED_NOW });
}

async function revisionsOf(tx: Tx, recipeId: string) {
  return tx.select().from(recipeRevisions).where(eq(recipeRevisions.recipeId, recipeId));
}

describe("createRecipe", () => {
  it("writes the Recipe at latest_revision 1 and Revision 1 with a jsonb snapshot", async () => {
    const recipeId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    await inRollback(async (tx) => {
      const mutator = getMutator("createRecipe")!;
      await mutator.run(tx, mutator.args.parse({ recipeId, revisionId, name: "Velouté", servings: 4 }), {
        ownerId,
        timeZone: "Europe/Paris",
        now: () => FIXED_NOW,
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
          snapshot: { name: "Velouté", servings: 4, yield: null, makeAhead: null, steps: [], dependencies: [] },
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

describe("editRecipe", () => {
  it("bumps the Revision once and appends one Revision whose snapshot is the working copy", async () => {
    await inRollback(async (tx) => {
      const recipeId = crypto.randomUUID();
      await run(tx, "createRecipe", { recipeId, revisionId: crypto.randomUUID(), name: "Velouté" });
      const revisionId = crypto.randomUUID();

      await run(tx, "editRecipe", { recipeId, revisionId, name: "Velouté de champignons", servings: 6 });

      const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, recipeId));
      expect(recipe).toMatchObject({ name: "Velouté de champignons", servings: "6", latestRevision: 2 });
      const revisions = await revisionsOf(tx, recipeId);
      expect(revisions).toHaveLength(2);
      const revision2 = revisions.find((r) => r.number === 2)!;
      expect(revision2.id).toBe(revisionId);
      expect(revision2.snapshot).toEqual(await loadRecipeSnapshot(tx, ownerId, recipeId));
      expect(revision2.snapshot).toEqual({ name: "Velouté de champignons", servings: 6, yield: null, makeAhead: null, steps: [], dependencies: [] });
    });
  });

  it("refuses another owner's Recipe with NotFoundError, and appends no Revision", async () => {
    await inRollback(async (tx) => {
      const recipeId = crypto.randomUUID();
      await run(tx, "createRecipe", { recipeId, revisionId: crypto.randomUUID(), name: "Velouté" });

      await expect(
        run(tx, "editRecipe", { recipeId, revisionId: crypto.randomUUID(), name: "Mine now" }, crypto.randomUUID()),
      ).rejects.toThrow(NotFoundError);

      expect(await revisionsOf(tx, recipeId)).toHaveLength(1);
      const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, recipeId));
      expect(recipe).toMatchObject({ name: "Velouté", latestRevision: 1 });
    });
  });

  it("needs a name or servings, and can clear servings", () => {
    const args = getMutator("editRecipe")!.args;
    const ids = { recipeId: crypto.randomUUID(), revisionId: crypto.randomUUID() };
    expect(args.safeParse(ids).success).toBe(false);
    expect(args.safeParse({ ...ids, servings: null }).success).toBe(true);
  });
});
