import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { effectiveMakeAhead } from "../recipe/planning.ts";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import { recipeRevisions, recipes, steps } from "../schema.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

const ownerId = crypto.randomUUID();

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner });
}

// "Chicken stock <tag>" at Revision 4: three plain-text Steps.
async function chickenStock(tx: Tx) {
  const recipeId = crypto.randomUUID();
  await run(tx, "createRecipe", {
    recipeId,
    revisionId: crypto.randomUUID(),
    name: `Chicken stock ${crypto.randomUUID().slice(0, 8)}`,
  });
  const stepIds: string[] = [];
  for (const text of [
    "Roast the bones",
    "Simmer for four hours",
    "Strain and cool",
  ]) {
    const stepId = crypto.randomUUID();
    await run(tx, "addStep", {
      recipeId,
      stepId,
      revisionId: crypto.randomUUID(),
      body: [{ type: "text", text }],
      lines: [],
    });
    stepIds.push(stepId);
  }
  return { recipeId, stepIds: stepIds as [string, string, string] };
}

async function revisions(tx: Tx, recipeId: string) {
  const [recipe] = await tx
    .select()
    .from(recipes)
    .where(eq(recipes.id, recipeId));
  const rows = await tx
    .select()
    .from(recipeRevisions)
    .where(eq(recipeRevisions.recipeId, recipeId));
  return { latest: recipe!.latestRevision, count: rows.length, rows };
}

describe("setMakeAhead", () => {
  it("saves Chicken stock's make-ahead window and one Step's own; the effective window reads each", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      const [one, two, three] = stepIds;

      await run(tx, "setMakeAhead", {
        target: { kind: "recipe", recipeId },
        revisionId: crypto.randomUUID(),
        window: { beforeDays: 3, shelfLifeDays: 4 },
      });
      await run(tx, "setMakeAhead", {
        target: { kind: "step", stepId: two },
        revisionId: crypto.randomUUID(),
        window: { beforeDays: 1, shelfLifeDays: 2 },
      });

      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(eq(recipes.id, recipeId));
      expect(recipe).toMatchObject({
        makeAheadBeforeDays: 3,
        shelfLifeDays: 4,
      });
      const [row] = await tx.select().from(steps).where(eq(steps.id, two));
      expect(row).toMatchObject({ makeAheadBeforeDays: 1, shelfLifeDays: 2 });
      const snapshot = await loadRecipeSnapshot(tx, ownerId, recipeId);
      expect(
        snapshot.steps.map((s) => [s.id, effectiveMakeAhead(s, snapshot)]),
      ).toEqual([
        [one, { beforeDays: 3, shelfLifeDays: 4, from: "recipe" }],
        [two, { beforeDays: 1, shelfLifeDays: 2, from: "step" }],
        [three, { beforeDays: 3, shelfLifeDays: 4, from: "recipe" }],
      ]);
    });
  });

  it("a Step's null make-ahead window inherits its Recipe's again", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      await run(tx, "setMakeAhead", {
        target: { kind: "recipe", recipeId },
        revisionId: crypto.randomUUID(),
        window: { beforeDays: 3, shelfLifeDays: 4 },
      });
      const target = { kind: "step", stepId: stepIds[0] };
      await run(tx, "setMakeAhead", {
        target,
        revisionId: crypto.randomUUID(),
        window: { beforeDays: 0, shelfLifeDays: 0 },
      });
      await run(tx, "setMakeAhead", {
        target,
        revisionId: crypto.randomUUID(),
        window: null,
      });

      const snapshot = await loadRecipeSnapshot(tx, ownerId, recipeId);
      expect(snapshot.steps[0]!.makeAhead).toBeNull();
      expect(effectiveMakeAhead(snapshot.steps[0]!, snapshot)).toEqual({
        beforeDays: 3,
        shelfLifeDays: 4,
        from: "recipe",
      });
    });
  });
});

describe("setStepTimes", () => {
  it("saves a Step's active and passive times", async () => {
    await inRollback(async (tx) => {
      const { stepIds } = await chickenStock(tx);
      await run(tx, "setStepTimes", {
        stepId: stepIds[1],
        revisionId: crypto.randomUUID(),
        activeMinutes: 15,
        passiveMinutes: null,
      });
      const [row] = await tx
        .select()
        .from(steps)
        .where(eq(steps.id, stepIds[1]));
      expect(row).toMatchObject({ activeMinutes: 15, passiveMinutes: null });
    });
  });

  it("refuses times out of range or not whole minutes", () => {
    const { args } = getMutator("setStepTimes")!;
    const base = {
      stepId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      passiveMinutes: null,
    };
    for (const activeMinutes of [-1, 10081, 1.5, "10"])
      expect(args.safeParse({ ...base, activeMinutes }).success).toBe(false);
    expect(args.safeParse({ ...base, activeMinutes: 10080 }).success).toBe(
      true,
    );
    const window = getMutator("setMakeAhead")!.args;
    const target = { kind: "recipe", recipeId: crypto.randomUUID() };
    for (const bad of [
      { beforeDays: 31, shelfLifeDays: 1 },
      { beforeDays: 1, shelfLifeDays: 366 },
      { beforeDays: 1.5, shelfLifeDays: 1 },
      { beforeDays: 1 },
    ])
      expect(
        window.safeParse({
          target,
          revisionId: crypto.randomUUID(),
          window: bad,
        }).success,
      ).toBe(false);
  });

  it("refuses another owner's Step with NotFoundError", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      const args = {
        stepId: stepIds[0],
        revisionId: crypto.randomUUID(),
        activeMinutes: 5,
        passiveMinutes: 5,
      };
      await expect(
        run(tx, "setStepTimes", args, crypto.randomUUID()),
      ).rejects.toThrow(NotFoundError);
      await expect(
        run(
          tx,
          "setMakeAhead",
          {
            target: { kind: "recipe", recipeId },
            revisionId: crypto.randomUUID(),
            window: null,
          },
          crypto.randomUUID(),
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
