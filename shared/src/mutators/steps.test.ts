import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { findPlanningCycle, stepGroups } from "../recipe/planning.ts";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import {
  ingredientLines,
  ingredients,
  recipeRevisions,
  recipes,
  stepDependencies,
  steps,
} from "../schema.ts";
import { ConflictError } from "./define.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");

const ownerId = crypto.randomUUID();

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), {
    ownerId: owner,
    timeZone: "Europe/Paris",
    now: () => FIXED_NOW,
  });
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
  const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, recipeId));
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
      expect(revision2.snapshot).toEqual(await loadRecipeSnapshot(tx, ownerId, f.recipeId));
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
      const [line] = await tx.select().from(ingredientLines).where(eq(ingredientLines.id, lineId));
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
    expect(args.safeParse({ ...ids, body: [{ type: "line", lineId }], lines: [] }).success).toBe(
      false,
    );
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

  it("refuses an amount that is zero, divides by zero, is unreadable or has an inverted range", () => {
    const args = getMutator("addStep")!.args;
    const lineId = crypto.randomUUID();
    const withAmount = (amount: string) =>
      args.safeParse({
        recipeId: crypto.randomUUID(),
        stepId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        body: [{ type: "line", lineId }],
        lines: [
          {
            lineId,
            ingredientId: crypto.randomUUID(),
            amount,
            wording: "salt",
          },
        ],
      }).success;
    expect(withAmount("1/0")).toBe(false);
    expect(withAmount("0/0%g")).toBe(false);
    // Short enough for the length limit, so the refine is what refuses it.
    expect(withAmount("1 1/0")).toBe(false);
    expect(withAmount("3-2")).toBe(false);
    expect(withAmount("0")).toBe(false);
    expect(withAmount("1,000 g")).toBe(false);
    expect(withAmount("9".repeat(40))).toBe(false);
    expect(withAmount("2-3")).toBe(true);
    expect(withAmount("1,5 kg")).toBe(true);
  });

  it("can't link a line to an Ingredient the caller can't see, and then appends nothing", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const hidden = crypto.randomUUID();
      await tx.insert(ingredients).values({
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
            lines: [{ lineId, ingredientId: hidden, amount: "1", wording: "thing" }],
          }),
        ),
      ).rejects.toThrow(NotFoundError);

      expect(await latestRevision(tx, f.recipeId)).toMatchObject({
        latest: 1,
        count: 1,
      });
      expect(await tx.select().from(steps).where(eq(steps.id, stepId))).toEqual([]);
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
      expect(snapshot.steps[0]!.lines.map((l) => [l.id, l.quantity, l.unit])).toEqual([
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

  it("refuses another owner's lineId with ConflictError, leaves their line alone and appends nothing", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const otherOwner = crypto.randomUUID();
      const theirRecipe = crypto.randomUUID();
      await run(
        tx,
        "createRecipe",
        {
          recipeId: theirRecipe,
          revisionId: crypto.randomUUID(),
          name: "Theirs",
        },
        otherOwner,
      );
      const theirs = sweat(f);
      await run(
        tx,
        "addStep",
        {
          recipeId: theirRecipe,
          stepId: crypto.randomUUID(),
          revisionId: crypto.randomUUID(),
          body: theirs.body,
          lines: theirs.lines,
        },
        otherOwner,
      );
      const stepId = crypto.randomUUID();
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId,
        revisionId: crypto.randomUUID(),
        body: [{ type: "text", text: "Rest" }],
        lines: [],
      });

      // A savepoint, so the failed mutation rolls back alone and the checks below can still run.
      await expect(
        tx.transaction(async (sp) =>
          run(sp, "editStep", {
            stepId,
            revisionId: crypto.randomUUID(),
            body: [{ type: "line", lineId: theirs.butterLine }],
            lines: [
              {
                lineId: theirs.butterLine,
                ingredientId: f.butter,
                amount: "1 kg",
                wording: "butter",
              },
            ],
          }),
        ),
      ).rejects.toThrow(ConflictError);

      const [line] = await tx
        .select()
        .from(ingredientLines)
        .where(eq(ingredientLines.id, theirs.butterLine));
      expect(line).toMatchObject({
        ownerId: otherOwner,
        quantity: "30",
        unit: "g",
      });
      expect(line!.stepId).not.toBe(stepId);
      expect(await latestRevision(tx, f.recipeId)).toMatchObject({
        latest: 2,
        count: 2,
      });
    });
  });
});

describe("moveStep", () => {
  it("moves the last Step first: it keeps its id, sorts first and bumps the Revision once", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
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
      expect((await loadRecipeSnapshot(tx, ownerId, f.recipeId)).steps.map((s) => s.id)).toEqual([
        ids[0],
        ids[2],
        ids[1],
      ]);
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
        .where(and(eq(ingredientLines.stepId, stepId), isNull(ingredientLines.deletedAt)));
      expect(live).toEqual([]);
      expect((await loadRecipeSnapshot(tx, ownerId, f.recipeId)).steps).toEqual([]);
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
        run(tx, "removeStep", { stepId, revisionId: crypto.randomUUID() }, crypto.randomUUID()),
      ).rejects.toThrow(NotFoundError);
      const [step] = await tx.select().from(steps).where(eq(steps.id, stepId));
      expect(step!.deletedAt).toBeNull();
    });
  });
});

describe("Step mutations and their Revision", () => {
  async function newestRevision(tx: Tx, recipeId: string) {
    const { latest, count, revisions } = await latestRevision(tx, recipeId);
    const newest = revisions.find((r) => r.number === latest)!;
    return { latest, count, newest };
  }

  it("editStep, moveStep and removeStep each append one Revision whose snapshot is the working copy", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const stepId = crypto.randomUUID();
      const other = crypto.randomUUID();
      const s = sweat(f);
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId,
        revisionId: crypto.randomUUID(),
        body: s.body,
        lines: s.lines,
      });
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId: other,
        revisionId: crypto.randomUUID(),
        body: [{ type: "text", text: "Rest" }],
        lines: [],
      });
      let expected = 3;

      const edits: [string, Record<string, unknown>][] = [
        [
          "editStep",
          {
            stepId,
            body: [{ type: "line", lineId: s.shallotLine }],
            lines: [s.lines[0]],
          },
        ],
        ["moveStep", { stepId: other, afterStepId: null }],
        ["removeStep", { stepId }],
      ];
      for (const [name, args] of edits) {
        const revisionId = crypto.randomUUID();
        await run(tx, name, { ...args, revisionId });
        expected += 1;
        const { latest, count, newest } = await newestRevision(tx, f.recipeId);
        expect({ name, latest, count }).toEqual({
          name,
          latest: expected,
          count: expected,
        });
        expect(newest.id).toBe(revisionId);
        expect(newest.snapshot).toEqual(await loadRecipeSnapshot(tx, ownerId, f.recipeId));
      }
    });
  });

  it("a refused editStep or moveStep appends nothing and leaves the working copy as it was", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const s = sweat(f);
      const stepOne = crypto.randomUUID();
      const stepTwo = crypto.randomUUID();
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId: stepOne,
        revisionId: crypto.randomUUID(),
        body: s.body,
        lines: s.lines,
      });
      await run(tx, "addStep", {
        recipeId: f.recipeId,
        stepId: stepTwo,
        revisionId: crypto.randomUUID(),
        body: [{ type: "text", text: "Rest" }],
        lines: [],
      });
      const before = await loadRecipeSnapshot(tx, ownerId, f.recipeId);

      // Savepoints, so each failed mutation rolls back alone and the checks below can run.
      await expect(
        tx.transaction(async (sp) =>
          run(sp, "editStep", {
            stepId: stepTwo,
            revisionId: crypto.randomUUID(),
            body: [{ type: "line", lineId: s.butterLine }],
            lines: [s.lines[1]],
          }),
        ),
      ).rejects.toThrow(ConflictError);
      await expect(
        tx.transaction(async (sp) =>
          run(sp, "moveStep", {
            stepId: stepTwo,
            revisionId: crypto.randomUUID(),
            afterStepId: crypto.randomUUID(),
          }),
        ),
      ).rejects.toThrow(NotFoundError);

      expect(await latestRevision(tx, f.recipeId)).toMatchObject({
        latest: 3,
        count: 3,
      });
      expect(await loadRecipeSnapshot(tx, ownerId, f.recipeId)).toEqual(before);
    });
  });
});

describe("Step moves, removals, groups and dependencies", () => {
  // Steps a, b, c, d with b grouped with a and d with c; links a → b and a → c.
  async function planned(tx: Tx) {
    const { recipeId } = await fixture(tx);
    const [a, b, c, d] = [0, 1, 2, 3].map(() => crypto.randomUUID()) as [
      string,
      string,
      string,
      string,
    ];
    for (const [stepId, text] of [
      [a, "a"],
      [b, "b"],
      [c, "c"],
      [d, "d"],
    ] as const)
      await run(tx, "addStep", {
        recipeId,
        stepId,
        revisionId: crypto.randomUUID(),
        body: [{ type: "text", text }],
        lines: [],
      });
    for (const stepId of [b, d])
      await run(tx, "setGroupWithPrevious", {
        stepId,
        revisionId: crypto.randomUUID(),
        value: true,
      });
    for (const [beforeStepId, afterStepId] of [
      [a, b],
      [a, c],
    ])
      await run(tx, "addStepDependency", {
        dependencyId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        beforeStepId,
        afterStepId,
      });
    return { recipeId, a, b, c, d };
  }
  const groupsOf = async (tx: Tx, recipeId: string) =>
    stepGroups((await loadRecipeSnapshot(tx, ownerId, recipeId)).steps).map((g) => g.stepIds);

  it("removeStep soft-deletes its dependencies, both directions", async () => {
    await inRollback(async (tx) => {
      const { recipeId, a, b, c } = await planned(tx);
      await run(tx, "removeStep", { stepId: a, revisionId: crypto.randomUUID() });
      const live = await tx
        .select()
        .from(stepDependencies)
        .where(and(eq(stepDependencies.recipeId, recipeId), isNull(stepDependencies.deletedAt)));
      expect(live).toEqual([]);
      const all = await tx
        .select()
        .from(stepDependencies)
        .where(eq(stepDependencies.recipeId, recipeId));
      expect(all.map((d) => [d.beforeStepId, d.afterStepId]).sort()).toEqual(
        [
          [a, b],
          [a, c],
        ].sort(),
      );
    });
  });

  it("removing a group's key Step clears its follower's flag", async () => {
    await inRollback(async (tx) => {
      const { recipeId, b, c, d } = await planned(tx);
      await run(tx, "removeStep", { stepId: c, revisionId: crypto.randomUUID() });
      // d would otherwise join a and b's group.
      expect((await groupsOf(tx, recipeId)).slice(-1)).toEqual([[d]]);
      await run(tx, "removeStep", { stepId: b, revisionId: crypto.randomUUID() });
      expect((await groupsOf(tx, recipeId)).length).toBe(2);
    });
  });

  it("moving a grouped Step out of its group clears its flag and the Step's after its new slot", async () => {
    await inRollback(async (tx) => {
      const { recipeId, a, b, c, d } = await planned(tx);
      // b lands between c and d: b leaves a's group, and d doesn't join b.
      await run(tx, "moveStep", { stepId: b, revisionId: crypto.randomUUID(), afterStepId: c });
      expect(await groupsOf(tx, recipeId)).toEqual([[a], [c], [b], [d]]);
    });
  });

  it("after any move, no Step joins a different group and no cycle appears", async () => {
    await inRollback(async (tx) => {
      const { recipeId, a, b, c, d } = await planned(tx);
      const before = await groupsOf(tx, recipeId);
      const groupOf = new Map(before.flatMap((g, i) => g.map((id) => [id, i])));
      const rollback = new Error("rollback");
      for (const stepId of [a, b, c, d])
        for (const afterStepId of [null, a, b, c, d].filter((id) => id !== stepId)) {
          await tx
            .transaction(async (sp) => {
              await run(sp, "moveStep", { stepId, revisionId: crypto.randomUUID(), afterStepId });
              const snapshot = await loadRecipeSnapshot(sp, ownerId, recipeId);
              for (const group of stepGroups(snapshot.steps))
                expect({
                  stepId,
                  afterStepId,
                  groups: new Set(group.stepIds.map((id) => groupOf.get(id))).size,
                }).toEqual({
                  stepId,
                  afterStepId,
                  groups: 1,
                });
              expect(findPlanningCycle(snapshot.steps, snapshot.dependencies)).toBeNull();
              throw rollback;
            })
            .catch((e) => {
              if (e !== rollback) throw e;
            });
        }
    });
  });
});
