import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { effectiveMakeAhead, stepGroups } from "../recipe/planning.ts";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import { recipeRevisions, recipes, stepDependencies, steps } from "../schema.ts";
import { ConflictError, getMutator, InvalidArgsError, NotFoundError, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");

const ownerId = crypto.randomUUID();

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner, timeZone: "Europe/Paris", now: () => FIXED_NOW });
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

// Runs a mutation that should be refused in a savepoint, so the checks after it can still run.
async function refused(tx: Tx, name: string, args: unknown, error: new (...a: any[]) => Error) {
  let thrown: unknown;
  await tx.transaction(async (sp) => run(sp, name, args)).catch((e) => (thrown = e));
  expect(thrown).toBeInstanceOf(error);
  return thrown as Error;
}

const link = (beforeStepId: string, afterStepId: string) => ({
  dependencyId: crypto.randomUUID(),
  revisionId: crypto.randomUUID(),
  beforeStepId,
  afterStepId,
});

describe("setGroupWithPrevious", () => {
  it("refuses grouping the first Step, and appends nothing", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      const error = await refused(
        tx,
        "setGroupWithPrevious",
        { stepId: stepIds[0], revisionId: crypto.randomUUID(), value: true },
        InvalidArgsError,
      );
      expect(error.message).toBe("The first Step has no previous Step to group with");
      expect(await revisions(tx, recipeId)).toMatchObject({ latest: 4, count: 4 });
    });
  });

  it("grouping Step 2 makes Step 1 the Task's key Step", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      await run(tx, "setGroupWithPrevious", { stepId: stepIds[1], revisionId: crypto.randomUUID(), value: true });
      const snapshot = await loadRecipeSnapshot(tx, ownerId, recipeId);
      expect(stepGroups(snapshot.steps)).toEqual([
        { keyStepId: stepIds[0], stepIds: [stepIds[0], stepIds[1]] },
        { keyStepId: stepIds[2], stepIds: [stepIds[2]] },
      ]);
    });
  });

  it("refuses a grouping that makes a cycle with the links", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      const [one, two, three] = stepIds;
      await run(tx, "addStepDependency", link(one, three));
      await run(tx, "addStepDependency", link(three, two));
      await refused(tx, "setGroupWithPrevious", { stepId: two, revisionId: crypto.randomUUID(), value: true }, InvalidArgsError);
      expect(await revisions(tx, recipeId)).toMatchObject({ latest: 6, count: 6 });
    });
  });
});

describe("addStepDependency", () => {
  it("refuses a dependency between Steps of different Recipes, and appends nothing", async () => {
    await inRollback(async (tx) => {
      const stock = await chickenStock(tx);
      const other = await chickenStock(tx);
      const error = await refused(tx, "addStepDependency", link(other.stepIds[0], stock.stepIds[1]), InvalidArgsError);
      expect(error.message).toBe("A dependency links Steps of one Recipe");
      expect(await revisions(tx, stock.recipeId)).toMatchObject({ latest: 4, count: 4 });
      expect(await revisions(tx, other.recipeId)).toMatchObject({ latest: 4, count: 4 });
    });
  });

  it("refuses a dependency that makes a cycle, naming its Steps, and appends nothing", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      const [one, two, three] = stepIds;
      await refused(tx, "addStepDependency", link(one, one), InvalidArgsError);
      await run(tx, "addStepDependency", link(one, two));
      await refused(tx, "addStepDependency", link(two, one), InvalidArgsError);
      await run(tx, "addStepDependency", link(two, three));
      const error = await refused(tx, "addStepDependency", link(three, one), InvalidArgsError);
      expect(error.message).toBe(
        "This would make a cycle: Roast the bones → Simmer for four hours → Strain and cool → Roast the bones",
      );
      expect(await revisions(tx, recipeId)).toMatchObject({ latest: 6, count: 6 });
    });
  });

  it("refuses a live duplicate with ConflictError", async () => {
    await inRollback(async (tx) => {
      const { stepIds } = await chickenStock(tx);
      await run(tx, "addStepDependency", link(stepIds[0], stepIds[1]));
      await refused(tx, "addStepDependency", link(stepIds[0], stepIds[1]), ConflictError);
    });
  });

  it("re-adding a removed pair brings its row back", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      const first = link(stepIds[0], stepIds[2]);
      await run(tx, "addStepDependency", first);
      await run(tx, "removeStepDependency", { dependencyId: first.dependencyId, revisionId: crypto.randomUUID() });
      expect((await loadRecipeSnapshot(tx, ownerId, recipeId)).dependencies).toEqual([]);

      await run(tx, "addStepDependency", link(stepIds[0], stepIds[2]));
      const rows = await tx.select().from(stepDependencies).where(eq(stepDependencies.recipeId, recipeId));
      expect(rows).toEqual([expect.objectContaining({ id: first.dependencyId, deletedAt: null })]);
      expect((await loadRecipeSnapshot(tx, ownerId, recipeId)).dependencies).toEqual([
        { id: first.dependencyId, beforeStepId: stepIds[0], afterStepId: stepIds[2] },
      ]);
    });
  });
});

describe("removeStepDependency", () => {
  it("refuses an unknown dependency with NotFoundError", async () => {
    await inRollback(async (tx) => {
      await chickenStock(tx);
      await refused(
        tx,
        "removeStepDependency",
        { dependencyId: crypto.randomUUID(), revisionId: crypto.randomUUID() },
        NotFoundError,
      );
    });
  });
});

describe("planning changes and their Revision", () => {
  it("each planning change appends one Revision whose snapshot is the working copy", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      const [one, two, three] = stepIds;
      const dependencyId = crypto.randomUUID();
      const changes: [string, Record<string, unknown>, (s: Awaited<ReturnType<typeof loadRecipeSnapshot>>) => unknown][] = [
        ["setStepTimes", { stepId: one, activeMinutes: 20, passiveMinutes: 40 }, (s) => s.steps[0]!.passiveMinutes === 40],
        [
          "setMakeAhead",
          { target: { kind: "recipe", recipeId }, window: { beforeDays: 3, shelfLifeDays: 4 } },
          (s) => s.makeAhead?.beforeDays === 3,
        ],
        [
          "setMakeAhead",
          { target: { kind: "step", stepId: two }, window: { beforeDays: 1, shelfLifeDays: 2 } },
          (s) => s.steps[1]!.makeAhead?.beforeDays === 1,
        ],
        ["setGroupWithPrevious", { stepId: three, value: true }, (s) => s.steps[2]!.groupWithPrevious],
        ["addStepDependency", { dependencyId, beforeStepId: one, afterStepId: two }, (s) => s.dependencies.length === 1],
        ["removeStepDependency", { dependencyId }, (s) => s.dependencies.length === 0],
      ];
      let expected = 4;
      for (const [name, args, holds] of changes) {
        const revisionId = crypto.randomUUID();
        await run(tx, name, { ...args, revisionId });
        expected += 1;
        const { latest, count, rows } = await revisions(tx, recipeId);
        expect({ name, latest, count }).toEqual({ name, latest: expected, count: expected });
        const newest = rows.find((r) => r.number === latest)!;
        expect(newest.id).toBe(revisionId);
        const working = await loadRecipeSnapshot(tx, ownerId, recipeId);
        expect(newest.snapshot).toEqual(working);
        expect({ name, holds: holds(working) }).toEqual({ name, holds: true });
      }
    });
  });

  it("a refused planning change appends nothing and leaves the working copy as it was", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await chickenStock(tx);
      const before = await loadRecipeSnapshot(tx, ownerId, recipeId);
      await refused(tx, "setGroupWithPrevious", { stepId: stepIds[0], revisionId: crypto.randomUUID(), value: true }, InvalidArgsError);
      await refused(tx, "addStepDependency", link(stepIds[1], stepIds[1]), InvalidArgsError);
      await refused(tx, "setStepTimes", { stepId: crypto.randomUUID(), revisionId: crypto.randomUUID(), activeMinutes: 1, passiveMinutes: null }, NotFoundError);
      expect(await revisions(tx, recipeId)).toMatchObject({ latest: 4, count: 4 });
      expect(await loadRecipeSnapshot(tx, ownerId, recipeId)).toEqual(before);
    });
  });
});
