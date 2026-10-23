import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import {
  ingredientLines,
  ingredients,
  recipeRevisions,
  recipes,
  steps,
} from "../schema.ts";
import { ConflictError } from "./define.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

const ownerId = crypto.randomUUID();

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner });
}

// A Recipe at Revision 1 and two seed Ingredients of the tests' own (see ingredients.test.ts).
async function fixture(tx: Tx) {
  const tag = crypto.randomUUID().slice(0, 8);
  const shallot = crypto.randomUUID();
  const butter = crypto.randomUUID();
  await tx.insert(ingredients).values([
    {
      id: shallot,
      ownerId: null,
      name: `${tag} shallot`,
      source: "seed",
      preferredKind: "count",
    },
    {
      id: butter,
      ownerId: null,
      name: `${tag} butter`,
      source: "seed",
      preferredKind: "mass",
    },
  ]);
  const recipeId = crypto.randomUUID();
  await run(tx, "createRecipe", {
    recipeId,
    revisionId: crypto.randomUUID(),
    name: `Sauce ${tag}`,
  });
  return { recipeId, shallot, butter };
}

// "Sweat @shallots{2}(brunoise) in @butter{30%g}" as the editor sends it.
function sweat(f: { shallot: string; butter: string }) {
  const shallotLine = crypto.randomUUID();
  const butterLine = crypto.randomUUID();
  return {
    shallotLine,
    butterLine,
    body: [
      { type: "text", text: "Sweat " },
      { type: "line", lineId: shallotLine },
      { type: "text", text: " in " },
      { type: "line", lineId: butterLine },
    ],
    lines: [
      {
        lineId: shallotLine,
        ingredientId: f.shallot,
        amount: "2",
        wording: "shallots",
        preparation: "brunoise",
      },
      {
        lineId: butterLine,
        ingredientId: f.butter,
        amount: "30%g",
        wording: "butter",
      },
    ],
  };
}

async function latestRevision(tx: Tx, recipeId: string) {
  const [recipe] = await tx
    .select()
    .from(recipes)
    .where(eq(recipes.id, recipeId));
  const revisions = await tx
    .select()
    .from(recipeRevisions)
    .where(eq(recipeRevisions.recipeId, recipeId));
  return { latest: recipe!.latestRevision, count: revisions.length, revisions };
}

describe("addStep", () => {
  it("writes the Step, its linked lines with parsed Quantities, and Revision 2", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const stepId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const { shallotLine, butterLine, body, lines } = sweat(f);

      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId,
        revisionId,
        body,
        lines,
      });

      const [step] = await tx.select().from(steps).where(eq(steps.id, stepId));
      expect(step).toMatchObject({ recipeId: f.recipeId, ownerId, body });
      const rows = await tx
        .select()
        .from(ingredientLines)
        .where(eq(ingredientLines.stepId, stepId));
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: shallotLine,
            ingredientId: f.shallot,
            quantity: "2",
            unit: null,
            wording: "shallots",
            preparation: "brunoise",
            ownerId,
          }),
          expect.objectContaining({
            id: butterLine,
            ingredientId: f.butter,
            quantity: "30",
            unit: "g",
            wording: "butter",
            fixedQuantity: false,
          }),
        ]),
      );
      const { latest, count, revisions } = await latestRevision(tx, f.recipeId);
      expect({ latest, count }).toEqual({ latest: 2, count: 2 });
      const revision2 = revisions.find((r) => r.number === 2)!;
      expect(revision2.id).toBe(revisionId);
      expect(revision2.snapshot).toEqual(
        await loadRecipeSnapshot(tx, ownerId, f.recipeId),
      );
    });
  });

  it("stores a range's upper end and the Fixed flag", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const lineId = crypto.randomUUID();
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        body: [{ type: "line", lineId }],
        lines: [
          {
            lineId,
            ingredientId: f.shallot,
            amount: "=2-3",
            wording: "shallots",
          },
        ],
      });
      const [line] = await tx
        .select()
        .from(ingredientLines)
        .where(eq(ingredientLines.id, lineId));
      expect(line).toMatchObject({
        quantity: "2",
        quantityMax: "3",
        fixedQuantity: true,
      });
    });
  });

  it("refuses a body whose line tokens don't match its lines, and an empty Step", () => {
    const args = getMutator("addStep")!.args;
    const ids = {
      recipeId: crypto.randomUUID(),
      stepId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
    };
    const lineId = crypto.randomUUID();
    const line = {
      lineId,
      ingredientId: crypto.randomUUID(),
      amount: "",
      wording: "salt",
    };
    expect(
      args.safeParse({
        ...ids,
        body: [{ type: "line", lineId }],
        lines: [line],
      }).success,
    ).toBe(true);
    expect(
      args.safeParse({
        ...ids,
        body: [{ type: "text", text: "Stir" }],
        lines: [line],
      }).success,
    ).toBe(false);
    expect(
      args.safeParse({ ...ids, body: [{ type: "line", lineId }], lines: [] })
        .success,
    ).toBe(false);
    expect(
      args.safeParse({
        ...ids,
        body: [
          { type: "line", lineId },
          { type: "line", lineId },
        ],
        lines: [line],
      }).success,
    ).toBe(false);
    expect(
      args.safeParse({
        ...ids,
        body: [{ type: "text", text: "  " }],
        lines: [],
      }).success,
    ).toBe(false);
  });

  it("can't link a line to an Ingredient the caller can't see, and then appends nothing", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const hidden = crypto.randomUUID();
      await tx
        .insert(ingredients)
        .values({
          id: hidden,
          ownerId: crypto.randomUUID(),
          name: "someone's thing",
          source: "own",
        });
      const stepId = crypto.randomUUID();
      const lineId = crypto.randomUUID();

      // A savepoint, so the failed mutation rolls back alone and the checks below can still run.
      await expect(
        tx.transaction(async (sp) =>
          run(sp, "addStep", {
            recipeId: f.recipeId,
            stepId,
            revisionId: crypto.randomUUID(),
            body: [{ type: "line", lineId }],
            lines: [
              { lineId, ingredientId: hidden, amount: "1", wording: "thing" },
            ],
          }),
        ),
      ).rejects.toThrow(NotFoundError);

      expect(await latestRevision(tx, f.recipeId)).toMatchObject({
        latest: 1,
        count: 1,
      });
      expect(await tx.select().from(steps).where(eq(steps.id, stepId))).toEqual(
        [],
      );
    });
  });

  it("puts a Step first, or after a given Step", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const add = (stepId: string, text: string, afterStepId?: string | null) =>
        run(tx, "addStep", {
          recipeId: f.recipeId,
          stepId,
          revisionId: crypto.randomUUID(),
          ...(afterStepId !== undefined && { afterStepId }),
          body: [{ type: "text", text }],
          lines: [],
        });
      const [a, b, c, d] = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      await add(a, "A");
      await add(b, "B");
      await add(c, "C", null);
      await add(d, "D", a);

      const snapshot = await loadRecipeSnapshot(tx, ownerId, f.recipeId);
      expect(snapshot.steps.map((s) => s.id)).toEqual([c, a, d, b]);
    });
  });
});

describe("editStep", () => {
  it("keeps its id and kept line ids, soft-deletes a dropped line and adds a new one", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const stepId = crypto.randomUUID();
      const first = sweat(f);
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId,
        revisionId: crypto.randomUUID(),
        body: first.body,
        lines: first.lines,
      });
      const newLine = crypto.randomUUID();

      await run(tx, "editStep", {
        stepId,
        revisionId: crypto.randomUUID(),
        body: [
          { type: "text", text: "Sweat " },
          { type: "line", lineId: first.shallotLine },
          { type: "text", text: " in " },
          { type: "line", lineId: newLine },
        ],
        lines: [
          {
            lineId: first.shallotLine,
            ingredientId: f.shallot,
            amount: "3",
            wording: "shallots",
            preparation: "brunoise",
          },
          {
            lineId: newLine,
            ingredientId: f.butter,
            amount: "1 tbsp",
            wording: "clarified butter",
          },
        ],
      });

      const snapshot = await loadRecipeSnapshot(tx, ownerId, f.recipeId);
      expect(snapshot.steps.map((s) => s.id)).toEqual([stepId]);
      expect(
        snapshot.steps[0]!.lines.map((l) => [l.id, l.quantity, l.unit]),
      ).toEqual([
        [first.shallotLine, 3, null],
        [newLine, 1, "tbsp"],
      ]);
      const [dropped] = await tx
        .select()
        .from(ingredientLines)
        .where(eq(ingredientLines.id, first.butterLine));
      expect(dropped!.deletedAt).not.toBeNull();
      expect(await latestRevision(tx, f.recipeId)).toMatchObject({
        latest: 3,
        count: 3,
      });
    });
  });

  it("refuses a lineId that belongs to another Step with ConflictError", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const one = sweat(f);
      const stepOne = crypto.randomUUID();
      const stepTwo = crypto.randomUUID();
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId: stepOne,
        revisionId: crypto.randomUUID(),
        body: one.body,
        lines: one.lines,
      });
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId: stepTwo,
        revisionId: crypto.randomUUID(),
        body: [{ type: "text", text: "Rest" }],
        lines: [],
      });

      await expect(
        run(tx, "editStep", {
          stepId: stepTwo,
          revisionId: crypto.randomUUID(),
          body: [{ type: "line", lineId: one.butterLine }],
          lines: [
            {
              lineId: one.butterLine,
              ingredientId: f.butter,
              amount: "",
              wording: "butter",
            },
          ],
        }),
      ).rejects.toThrow(ConflictError);
    });
  });
});

describe("moveStep", () => {
  it("moves the last Step first: it keeps its id, sorts first and bumps the Revision once", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const ids = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      for (const stepId of ids) {
        await run(tx, "addStep", {
          recipeId: f.recipeId,
          stepId,
          revisionId: crypto.randomUUID(),
          body: [{ type: "text", text: "x" }],
          lines: [],
        });
      }

      await run(tx, "moveStep", {
        stepId: ids[2],
        revisionId: crypto.randomUUID(),
        afterStepId: null,
      });

      const snapshot = await loadRecipeSnapshot(tx, ownerId, f.recipeId);
      expect(snapshot.steps.map((s) => s.id)).toEqual([ids[2], ids[0], ids[1]]);
      expect(await latestRevision(tx, f.recipeId)).toMatchObject({
        latest: 5,
        count: 5,
      });

      await run(tx, "moveStep", {
        stepId: ids[2],
        revisionId: crypto.randomUUID(),
        afterStepId: ids[0],
      });
      expect(
        (await loadRecipeSnapshot(tx, ownerId, f.recipeId)).steps.map(
          (s) => s.id,
        ),
      ).toEqual([ids[0], ids[2], ids[1]]);
    });
  });
});

describe("removeStep", () => {
  it("soft-deletes the Step and its lines, drops it from the snapshot and bumps the Revision once", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const stepId = crypto.randomUUID();
      const { body, lines } = sweat(f);
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId,
        revisionId: crypto.randomUUID(),
        body,
        lines,
      });

      await run(tx, "removeStep", { stepId, revisionId: crypto.randomUUID() });

      const [step] = await tx.select().from(steps).where(eq(steps.id, stepId));
      expect(step!.deletedAt).not.toBeNull();
      const live = await tx
        .select()
        .from(ingredientLines)
        .where(
          and(
            eq(ingredientLines.stepId, stepId),
            isNull(ingredientLines.deletedAt),
          ),
        );
      expect(live).toEqual([]);
      expect((await loadRecipeSnapshot(tx, ownerId, f.recipeId)).steps).toEqual(
        [],
      );
      expect(await latestRevision(tx, f.recipeId)).toMatchObject({
        latest: 3,
        count: 3,
      });
      await expect(
        run(tx, "removeStep", { stepId, revisionId: crypto.randomUUID() }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("refuses another owner's Step with NotFoundError", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const stepId = crypto.randomUUID();
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId,
        revisionId: crypto.randomUUID(),
        body: [{ type: "text", text: "x" }],
        lines: [],
      });
      await expect(
        run(
          tx,
          "removeStep",
          { stepId, revisionId: crypto.randomUUID() },
          crypto.randomUUID(),
        ),
      ).rejects.toThrow(NotFoundError);
      const [step] = await tx.select().from(steps).where(eq(steps.id, stepId));
      expect(step!.deletedAt).toBeNull();
    });
  });
});
