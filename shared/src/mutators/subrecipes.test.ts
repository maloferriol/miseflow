import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { loadRecipeSnapshot } from "../recipe/snapshot.ts";
import {
  ingredientLines,
  ingredients,
  recipeRevisions,
  recipes,
  stepDependencies,
  steps,
} from "../schema.ts";
import { getMutator, InvalidArgsError, NotFoundError, type Tx } from "./registry.ts";

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

// Runs a mutation that should be refused in a savepoint, so the checks after it can still run.
async function refused(tx: Tx, name: string, args: unknown, error: new (...a: never[]) => Error) {
  let thrown: unknown;
  await tx.transaction(async (sp) => run(sp, name, args)).catch((e) => (thrown = e));
  expect(thrown).toBeInstanceOf(error);
  return thrown as Error;
}

async function revisions(tx: Tx, recipeId: string) {
  const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, recipeId));
  const rows = await tx
    .select()
    .from(recipeRevisions)
    .where(eq(recipeRevisions.recipeId, recipeId));
  return { latest: recipe.latestRevision, count: rows.length, rows };
}

async function createRecipe(tx: Tx, name: string, owner = ownerId) {
  const recipeId = crypto.randomUUID();
  await run(tx, "createRecipe", { recipeId, revisionId: crypto.randomUUID(), name }, owner);
  return recipeId;
}

// A Step "<verb> @<wording>{<amount>}" whose one line uses `subRecipeId`.
function usingSubRecipe(subRecipeId: string, wording: string, amount: string, verb = "Add") {
  const lineId = crypto.randomUUID();
  return {
    lineId,
    body: [
      { type: "text", text: `${verb} ` },
      { type: "line", lineId },
    ],
    lines: [{ lineId, subRecipeId, amount, wording }],
  };
}
// The same Step's body and lines, ready to spread into addStep's args.
function contentUsing(subRecipeId: string, wording: string, amount = "1") {
  const { lineId: _, ...content } = usingSubRecipe(subRecipeId, wording, amount);
  return content;
}

async function addStepUsing(tx: Tx, recipeId: string, subRecipeId: string, wording: string) {
  const stepId = crypto.randomUUID();
  await run(tx, "addStep", {
    recipeId,
    stepId,
    revisionId: crypto.randomUUID(),
    ...contentUsing(subRecipeId, wording),
  });
  return stepId;
}

describe("createSubRecipe", () => {
  it("makes an empty Chicken stock from Velouté's line @chicken stock{1.5%L}, which then links to it", async () => {
    await inRollback(async (tx) => {
      const veloute = await createRecipe(tx, "Velouté");
      const stepId = crypto.randomUUID();
      await run(tx, "addStep", {
        recipeId: veloute,
        stepId,
        revisionId: crypto.randomUUID(),
        body: [{ type: "text", text: "Add chicken stock" }],
        lines: [],
      });

      const stock = crypto.randomUUID();
      await run(tx, "createSubRecipe", {
        recipeId: stock,
        revisionId: crypto.randomUUID(),
        name: "Chicken stock",
      });
      const { lineId, body, lines } = usingSubRecipe(stock, "chicken stock", "1.5%L");
      await run(tx, "editStep", { stepId, revisionId: crypto.randomUUID(), body, lines });

      const created = await revisions(tx, stock);
      expect(created).toMatchObject({ latest: 1, count: 1 });
      expect(created.rows[0].snapshot).toMatchObject({
        name: "Chicken stock",
        yield: null,
        steps: [],
      });
      const [line] = await tx.select().from(ingredientLines).where(eq(ingredientLines.id, lineId));
      expect(line).toMatchObject({
        subRecipeId: stock,
        ingredientId: null,
        quantity: "1.5",
        unit: "L",
        wording: "chicken stock",
      });
      expect(await revisions(tx, veloute)).toMatchObject({ latest: 3, count: 3 });
    });
  });

  it("takes an optional yield", async () => {
    await inRollback(async (tx) => {
      const stock = crypto.randomUUID();
      await run(tx, "createSubRecipe", {
        recipeId: stock,
        revisionId: crypto.randomUUID(),
        name: "Chicken stock",
        yield: "2 L",
      });
      expect((await loadRecipeSnapshot(tx, ownerId, stock)).yield).toEqual({
        quantity: 2,
        unit: "L",
      });
    });
  });

  it("refuses a line with both an Ingredient and a sub-recipe, or neither", () => {
    const args = getMutator("addStep")!.args;
    const lineId = crypto.randomUUID();
    const step = (line: object) => ({
      recipeId: crypto.randomUUID(),
      stepId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      body: [{ type: "line", lineId }],
      lines: [{ lineId, amount: "1", wording: "stock", ...line }],
    });
    const id = crypto.randomUUID();
    expect(() => args.parse(step({ ingredientId: id, subRecipeId: id }))).toThrow();
    expect(() => args.parse(step({}))).toThrow();
    expect(() => args.parse(step({ subRecipeId: id }))).not.toThrow();
  });

  it("refuses linking another owner's or a soft-deleted Recipe as a sub-recipe", async () => {
    await inRollback(async (tx) => {
      const veloute = await createRecipe(tx, "Velouté");
      const theirs = await createRecipe(tx, "Their stock", crypto.randomUUID());
      const deleted = await createRecipe(tx, "Old stock");
      await tx.update(recipes).set({ deletedAt: new Date() }).where(eq(recipes.id, deleted));
      for (const target of [theirs, deleted])
        await refused(
          tx,
          "addStep",
          {
            recipeId: veloute,
            stepId: crypto.randomUUID(),
            revisionId: crypto.randomUUID(),
            ...contentUsing(target, "stock"),
          },
          NotFoundError,
        );
      expect(await revisions(tx, veloute)).toMatchObject({ latest: 1, count: 1 });
    });
  });
});

describe("sub-recipe cycle", () => {
  it("refuses making Beurre blanc a sub-recipe of Velouté when Beurre blanc uses Velouté, naming the cycle and writing nothing", async () => {
    await inRollback(async (tx) => {
      const veloute = await createRecipe(tx, "Velouté");
      const beurreBlanc = await createRecipe(tx, "Beurre blanc");
      await addStepUsing(tx, beurreBlanc, veloute, "velouté");
      const before = await loadRecipeSnapshot(tx, ownerId, veloute);

      const error = await refused(
        tx,
        "addStep",
        {
          recipeId: veloute,
          stepId: crypto.randomUUID(),
          revisionId: crypto.randomUUID(),
          ...contentUsing(beurreBlanc, "beurre blanc"),
        },
        InvalidArgsError,
      );
      expect(error.message).toContain("Velouté → Beurre blanc → Velouté");
      expect(await revisions(tx, veloute)).toMatchObject({ latest: 1, count: 1 });
      expect(await loadRecipeSnapshot(tx, ownerId, veloute)).toEqual(before);
    });
  });

  it("refuses a Recipe using itself", async () => {
    await inRollback(async (tx) => {
      const veloute = await createRecipe(tx, "Velouté");
      await refused(
        tx,
        "addStep",
        {
          recipeId: veloute,
          stepId: crypto.randomUUID(),
          revisionId: crypto.randomUUID(),
          ...contentUsing(veloute, "velouté"),
        },
        InvalidArgsError,
      );
      expect(await revisions(tx, veloute)).toMatchObject({ latest: 1, count: 1 });
    });
  });
});

describe("setYield", () => {
  it("stores 1.5 L and appends one Revision whose snapshot has the yield; null clears it", async () => {
    await inRollback(async (tx) => {
      const stock = await createRecipe(tx, "Chicken stock");
      await run(tx, "setYield", {
        recipeId: stock,
        revisionId: crypto.randomUUID(),
        yield: "1.5 L",
      });
      const [row] = await tx.select().from(recipes).where(eq(recipes.id, stock));
      expect(row).toMatchObject({ yieldQuantity: "1.5", yieldUnit: "L" });
      const after = await revisions(tx, stock);
      expect(after).toMatchObject({ latest: 2, count: 2 });
      const revision2 = after.rows.find((r) => r.number === 2)!;
      expect(revision2.snapshot).toMatchObject({ yield: { quantity: 1.5, unit: "L" } });

      await run(tx, "setYield", { recipeId: stock, revisionId: crypto.randomUUID(), yield: null });
      expect((await loadRecipeSnapshot(tx, ownerId, stock)).yield).toBeNull();
      expect(await revisions(tx, stock)).toMatchObject({ latest: 3, count: 3 });
    });
  });

  it("refuses a pinch, and appends nothing", async () => {
    await inRollback(async (tx) => {
      const stock = await createRecipe(tx, "Chicken stock");
      await refused(
        tx,
        "setYield",
        { recipeId: stock, revisionId: crypto.randomUUID(), yield: "a pinch" },
        InvalidArgsError,
      );
      expect(await revisions(tx, stock)).toMatchObject({ latest: 1, count: 1 });
    });
  });
});

// Tarte tatin with Steps s1..s4; s2 and s3 each hold one Ingredient line.
async function tarteTatin(tx: Tx) {
  const tag = crypto.randomUUID().slice(0, 8);
  const flour = crypto.randomUUID();
  const butter = crypto.randomUUID();
  await tx.insert(ingredients).values([
    { id: flour, ownerId: null, name: `${tag} flour`, source: "seed", preferredKind: "mass" },
    { id: butter, ownerId: null, name: `${tag} butter`, source: "seed", preferredKind: "mass" },
  ]);
  const recipeId = await createRecipe(tx, "Tarte tatin");
  const stepIds: string[] = [];
  const lineIds: string[] = [];
  const texts: [string, string | null][] = [
    ["Peel the apples", null],
    ["Rub in ", flour],
    ["Add ", butter],
    ["Bake", null],
  ];
  for (const [text, ingredientId] of texts) {
    const stepId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    await run(tx, "addStep", {
      recipeId,
      stepId,
      revisionId: crypto.randomUUID(),
      body: ingredientId
        ? [
            { type: "text", text },
            { type: "line", lineId },
          ]
        : [{ type: "text", text }],
      lines: ingredientId ? [{ lineId, ingredientId, amount: "100%g", wording: "x" }] : [],
    });
    stepIds.push(stepId);
    if (ingredientId) lineIds.push(lineId);
  }
  return { recipeId, stepIds, lineIds };
}

function extract(recipeId: string, stepIds: string[]) {
  return {
    recipeId,
    revisionId: crypto.randomUUID(),
    stepIds,
    subRecipeId: crypto.randomUUID(),
    subRecipeRevisionId: crypto.randomUUID(),
    name: "Pastry",
    stepId: crypto.randomUUID(),
    lineId: crypto.randomUUID(),
  };
}

describe("extractToSubRecipe", () => {
  it("moves two Steps of Tarte tatin into Pastry with the same ids and leaves one line using it, with a Revision for each", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds, lineIds } = await tarteTatin(tx);
      const [s1, s2, s3, s4] = stepIds as [string, string, string, string];
      const args = extract(recipeId, [s2, s3]);

      await run(tx, "extractToSubRecipe", args);

      const pastry = await loadRecipeSnapshot(tx, ownerId, args.subRecipeId);
      expect(pastry.name).toBe("Pastry");
      expect(pastry.steps.map((s) => s.id)).toEqual([s2, s3]);
      expect(pastry.steps.flatMap((s) => s.lines.map((l) => l.id))).toEqual(lineIds);
      const tarte = await loadRecipeSnapshot(tx, ownerId, recipeId);
      expect(tarte.steps.map((s) => s.id)).toEqual([s1, args.stepId, s4]);
      expect(tarte.steps[1].body).toEqual([{ type: "line", lineId: args.lineId }]);
      expect(tarte.steps[1].lines).toEqual([
        expect.objectContaining({
          id: args.lineId,
          subRecipeId: args.subRecipeId,
          ingredientId: null,
          quantity: 1,
          unit: null,
          wording: "Pastry",
        }),
      ]);

      const pastryRevisions = await revisions(tx, args.subRecipeId);
      expect(pastryRevisions).toMatchObject({ latest: 1, count: 1 });
      expect(pastryRevisions.rows[0].snapshot).toEqual(pastry);
      const tarteRevisions = await revisions(tx, recipeId);
      expect(tarteRevisions).toMatchObject({ latest: 6, count: 6 });
      expect(tarteRevisions.rows.find((r) => r.number === 6)!.snapshot).toEqual(tarte);
    });
  });

  it("refuses Steps that aren't consecutive, and writes nothing", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await tarteTatin(tx);
      const before = await loadRecipeSnapshot(tx, ownerId, recipeId);
      const args = extract(recipeId, [stepIds[0], stepIds[2]]);
      await refused(tx, "extractToSubRecipe", args, InvalidArgsError);
      expect(await loadRecipeSnapshot(tx, ownerId, recipeId)).toEqual(before);
      expect(await revisions(tx, recipeId)).toMatchObject({ latest: 5, count: 5 });
      expect(await tx.select().from(recipes).where(eq(recipes.id, args.subRecipeId))).toEqual([]);
    });
  });

  it("refuses another Recipe's Step", async () => {
    await inRollback(async (tx) => {
      const { recipeId } = await tarteTatin(tx);
      const other = await tarteTatin(tx);
      await refused(tx, "extractToSubRecipe", extract(recipeId, [other.stepIds[1]]), NotFoundError);
      expect(await revisions(tx, recipeId)).toMatchObject({ latest: 5, count: 5 });
    });
  });

  it("moves a dependency link between two extracted Steps into the sub-recipe", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await tarteTatin(tx);
      const dependencyId = crypto.randomUUID();
      await run(tx, "addStepDependency", {
        dependencyId,
        revisionId: crypto.randomUUID(),
        beforeStepId: stepIds[1],
        afterStepId: stepIds[2],
      });
      const args = extract(recipeId, [stepIds[1], stepIds[2]]);
      await run(tx, "extractToSubRecipe", args);
      expect((await loadRecipeSnapshot(tx, ownerId, args.subRecipeId)).dependencies).toEqual([
        { id: dependencyId, beforeStepId: stepIds[1], afterStepId: stepIds[2] },
      ]);
      expect((await loadRecipeSnapshot(tx, ownerId, recipeId)).dependencies).toEqual([]);
    });
  });

  it("soft-deletes a dependency link that crosses out of the extracted Steps", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await tarteTatin(tx);
      const dependencyId = crypto.randomUUID();
      await run(tx, "addStepDependency", {
        dependencyId,
        revisionId: crypto.randomUUID(),
        beforeStepId: stepIds[0],
        afterStepId: stepIds[2],
      });
      const args = extract(recipeId, [stepIds[1], stepIds[2]]);
      await run(tx, "extractToSubRecipe", args);
      const [row] = await tx
        .select()
        .from(stepDependencies)
        .where(eq(stepDependencies.id, dependencyId));
      expect(row.deletedAt).not.toBeNull();
      expect((await loadRecipeSnapshot(tx, ownerId, args.subRecipeId)).dependencies).toEqual([]);
    });
  });

  it("clears a group the extract splits, on both sides", async () => {
    await inRollback(async (tx) => {
      const { recipeId, stepIds } = await tarteTatin(tx);
      // Groups: [s1, s2] and [s3, s4]; extracting [s2, s3] splits both.
      for (const stepId of [stepIds[1], stepIds[3]])
        await run(tx, "setGroupWithPrevious", {
          stepId,
          revisionId: crypto.randomUUID(),
          value: true,
        });
      const args = extract(recipeId, [stepIds[1], stepIds[2]]);
      await run(tx, "extractToSubRecipe", args);
      const grouped = await tx
        .select({ id: steps.id, groupWithPrevious: steps.groupWithPrevious })
        .from(steps)
        .where(eq(steps.groupWithPrevious, true));
      expect(grouped.filter((s) => stepIds.includes(s.id))).toEqual([]);
    });
  });
});
