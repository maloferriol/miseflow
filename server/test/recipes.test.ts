import { getMutator, ingredientAliases, recipeRevisions, recipes } from "@miseflow/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSeed, readSeed } from "../src/seed.ts";
import { db, getToken, testApp } from "./helpers.ts";

async function send(method: "GET" | "POST", path: string, body?: unknown) {
  return testApp().request(path, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function mutate(name: string, args: Record<string, unknown>) {
  return send("POST", "/mutate", { id: crypto.randomUUID(), name, args });
}

async function ok(name: string, args: Record<string, unknown>) {
  const res = await mutate(name, args);
  expect(res.status, await res.clone().text()).toBe(200);
}

const seed = readSeed();
const seedId = (name: string) =>
  seed.ingredients.find((i) => i.name === name)!.id;

// Aliases taught here are soft-deleted afterwards, so the next run's near match is still near.
const createdAliases: string[] = [];
// Other owners' Recipes made here, soft-deleted afterwards like the aliases.
const othersRecipes: string[] = [];

// Another owner's Recipe, made the way the app makes one: with its Revision 1.
async function theirRecipe() {
  const recipeId = crypto.randomUUID();
  const createRecipe = getMutator("createRecipe")!;
  await db.transaction((tx) =>
    createRecipe.run(
      tx,
      createRecipe.args.parse({ recipeId, revisionId: crypto.randomUUID(), name: "Not yours" }),
      { ownerId: crypto.randomUUID() },
    ),
  );
  othersRecipes.push(recipeId);
  return recipeId;
}

beforeAll(async () => {
  await loadSeed(db);
});

afterAll(async () => {
  if (othersRecipes.length) {
    await db
      .update(recipes)
      .set({ deletedAt: sql`now()` })
      .where(inArray(recipes.id, othersRecipes));
  }
  if (createdAliases.length) {
    await db
      .update(ingredientAliases)
      .set({ deletedAt: sql`now()` })
      .where(inArray(ingredientAliases.id, createdAliases));
  }
});

async function newRecipe(name = `Sauce ${crypto.randomUUID().slice(0, 8)}`) {
  const recipeId = crypto.randomUUID();
  await ok("createRecipe", { recipeId, revisionId: crypto.randomUUID(), name });
  return recipeId;
}

async function revisionState(recipeId: string) {
  const [recipe] = await db
    .select()
    .from(recipes)
    .where(eq(recipes.id, recipeId));
  const rows = await db
    .select()
    .from(recipeRevisions)
    .where(eq(recipeRevisions.recipeId, recipeId));
  return { latest: recipe!.latestRevision, count: rows.length };
}

describe("GET /recipes/:recipeId", () => {
  it("returns Steps in order, lines with Ingredient names, and the derived ingredient list", async () => {
    const recipeId = await newRecipe();
    const [first, second, shallotLine, butterLine] = Array.from(
      { length: 4 },
      () => crypto.randomUUID(),
    );
    await ok("addStep", {
      recipeId,
      stepId: first,
      revisionId: crypto.randomUUID(),
      body: [
        { type: "text", text: "Sweat " },
        { type: "line", lineId: shallotLine },
        { type: "text", text: " in " },
        { type: "line", lineId: butterLine },
      ],
      lines: [
        {
          lineId: shallotLine,
          ingredientId: seedId("shallot"),
          amount: "2",
          wording: "shallots",
          preparation: "brunoise",
        },
        {
          lineId: butterLine,
          ingredientId: seedId("butter"),
          amount: "30%g",
          wording: "butter",
        },
      ],
    });
    await ok("addStep", {
      recipeId,
      stepId: second,
      revisionId: crypto.randomUUID(),
      body: [{ type: "text", text: "Rest" }],
      lines: [],
    });

    const res = await send("GET", `/recipes/${recipeId}`);

    expect(res.status).toBe(200);
    const { recipe } = await res.json();
    expect(recipe).toMatchObject({ id: recipeId, latestRevision: 3 });
    expect(recipe.steps.map((s: { id: string }) => s.id)).toEqual([
      first,
      second,
    ]);
    expect(recipe.steps[0].lines).toEqual([
      expect.objectContaining({
        id: shallotLine,
        ingredient: { id: seedId("shallot"), name: "shallot" },
        quantity: 2,
        unit: null,
        wording: "shallots",
        preparation: "brunoise",
      }),
      expect.objectContaining({
        id: butterLine,
        ingredient: { id: seedId("butter"), name: "butter" },
        quantity: 30,
        unit: "g",
        wording: "butter",
      }),
    ]);
    expect(recipe.ingredients.map((i: { lineId: string }) => i.lineId)).toEqual(
      [shallotLine, butterLine],
    );
  });

  it("reads another owner's Recipe, a missing one and a bad id as 404", async () => {
    const theirs = await theirRecipe();

    expect((await send("GET", `/recipes/${theirs}`)).status).toBe(404);
    expect((await send("GET", `/recipes/${crypto.randomUUID()}`)).status).toBe(
      404,
    );
    expect((await send("GET", "/recipes/not-a-uuid")).status).toBe(404);
  });
});

describe("GET /recipes", () => {
  it("lists the caller's live Recipes only, by name", async () => {
    const mine = await newRecipe();
    const theirs = await theirRecipe();

    const res = await send("GET", "/recipes");

    expect(res.status).toBe(200);
    const ids = (await res.json()).recipes.map((r: { id: string }) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });
});

describe("Ingredient line links (Revision)", () => {
  it("refuses a line without ingredientId with 400 INVALID_ARGS, and appends nothing", async () => {
    const recipeId = await newRecipe();
    const stepId = crypto.randomUUID();
    await ok("addStep", {
      recipeId,
      stepId,
      revisionId: crypto.randomUUID(),
      body: [{ type: "text", text: "Stir" }],
      lines: [],
    });
    const before = await revisionState(recipeId);
    const lineId = crypto.randomUUID();

    const res = await mutate("editStep", {
      stepId,
      revisionId: crypto.randomUUID(),
      body: [{ type: "line", lineId }],
      lines: [{ lineId, amount: "1", wording: "mystery" }],
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_ARGS");
    expect(await revisionState(recipeId)).toEqual(before);
  });

  it("a near match then addAlias then editStep links the line, and the alias is found exactly", async () => {
    const recipeId = await newRecipe();
    const stepId = crypto.randomUUID();
    await ok("addStep", {
      recipeId,
      stepId,
      revisionId: crypto.randomUUID(),
      body: [{ type: "text", text: "Stir" }],
      lines: [],
    });
    const name = "shallo";
    const near = (await (await send("GET", `/ingredients?q=${name}`)).json())
      .ingredients;
    const hit = near.find((i: { name: string }) => i.name === "shallot");
    expect(hit).toMatchObject({ exact: false });

    const aliasId = crypto.randomUUID();
    await ok("addAlias", { aliasId, ingredientId: hit.id, name });
    createdAliases.push(aliasId);
    const lineId = crypto.randomUUID();
    await ok("editStep", {
      stepId,
      revisionId: crypto.randomUUID(),
      body: [{ type: "line", lineId }],
      lines: [{ lineId, ingredientId: hit.id, amount: "2", wording: name }],
    });

    const { recipe } = await (await send("GET", `/recipes/${recipeId}`)).json();
    expect(recipe.steps[0].lines[0]).toMatchObject({
      id: lineId,
      ingredient: { id: hit.id, name: "shallot" },
    });
    const found = (await (await send("GET", `/ingredients?q=${name}`)).json())
      .ingredients[0];
    expect(found).toMatchObject({
      id: hit.id,
      exact: true,
      matchedBy: "alias",
    });
  });
});

describe("Planning pass (read and /mutate)", () => {
  // "Chicken stock <tag>": Dice the shallots / Sweat @shallots{2}(diced) / Strain.
  async function chickenStock() {
    const recipeId = await newRecipe(`Chicken stock ${crypto.randomUUID().slice(0, 8)}`);
    const [dice, sweat, strain, line] = Array.from({ length: 4 }, () => crypto.randomUUID());
    const add = (stepId: string, body: unknown[], lines: unknown[] = []) =>
      ok("addStep", { recipeId, stepId, revisionId: crypto.randomUUID(), body, lines });
    await add(dice!, [{ type: "text", text: "Dice the shallots" }]);
    await add(
      sweat!,
      [{ type: "text", text: "Sweat " }, { type: "line", lineId: line }],
      [{ lineId: line, ingredientId: seedId("shallot"), amount: "2", wording: "shallots", preparation: "diced" }],
    );
    await add(strain!, [{ type: "text", text: "Strain" }]);
    return { recipeId, dice: dice!, sweat: sweat!, strain: strain!, line: line! };
  }

  it("the read includes planning fields, the effective window, dependencies and ready to plan", async () => {
    const r = await chickenStock();
    await ok("setMakeAhead", {
      target: { kind: "recipe", recipeId: r.recipeId },
      revisionId: crypto.randomUUID(),
      window: { beforeDays: 3, shelfLifeDays: 4 },
    });
    await ok("setMakeAhead", {
      target: { kind: "step", stepId: r.sweat },
      revisionId: crypto.randomUUID(),
      window: { beforeDays: 1, shelfLifeDays: 2 },
    });
    await ok("setStepTimes", { stepId: r.dice, revisionId: crypto.randomUUID(), activeMinutes: 10, passiveMinutes: null });
    await ok("setStepTimes", { stepId: r.strain, revisionId: crypto.randomUUID(), activeMinutes: 0, passiveMinutes: 30 });
    await ok("setGroupWithPrevious", { stepId: r.strain, revisionId: crypto.randomUUID(), value: true });
    const dependencyId = crypto.randomUUID();
    await ok("addStepDependency", {
      dependencyId,
      revisionId: crypto.randomUUID(),
      beforeStepId: r.dice,
      afterStepId: r.sweat,
    });

    const { recipe } = await (await send("GET", `/recipes/${r.recipeId}`)).json();

    expect(recipe.makeAhead).toEqual({ beforeDays: 3, shelfLifeDays: 4 });
    expect(recipe.steps).toEqual([
      expect.objectContaining({
        id: r.dice,
        activeMinutes: 10,
        passiveMinutes: null,
        makeAhead: null,
        effectiveMakeAhead: { beforeDays: 3, shelfLifeDays: 4, from: "recipe" },
        groupWithPrevious: false,
      }),
      expect.objectContaining({
        id: r.sweat,
        activeMinutes: null,
        passiveMinutes: null,
        makeAhead: { beforeDays: 1, shelfLifeDays: 2 },
        effectiveMakeAhead: { beforeDays: 1, shelfLifeDays: 2, from: "step" },
      }),
      expect.objectContaining({ id: r.strain, activeMinutes: 0, passiveMinutes: 30, groupWithPrevious: true }),
    ]);
    expect(recipe.dependencies).toEqual([{ id: dependencyId, beforeStepId: r.dice, afterStepId: r.sweat }]);
    expect(recipe.readyToPlan).toEqual({
      missingDuration: [r.sweat],
      duplicates: [{ stepId: r.dice, lineId: r.line }],
    });
    expect(recipe.latestRevision).toBe(10);
  });

  it("/mutate refuses a dependency across Recipes with 400 INVALID_ARGS and appends nothing", async () => {
    const a = await chickenStock();
    const b = await chickenStock();
    const before = await revisionState(a.recipeId);
    const beforeB = await revisionState(b.recipeId);

    const res = await mutate("addStepDependency", {
      dependencyId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      beforeStepId: b.dice,
      afterStepId: a.sweat,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "INVALID_ARGS",
      message: "A dependency links Steps of one Recipe",
    });
    expect(await revisionState(a.recipeId)).toEqual(before);
    expect(await revisionState(b.recipeId)).toEqual(beforeB);
  });

  it("/mutate refuses a dependency making a cycle with 400, the cycle in the message", async () => {
    const r = await chickenStock();
    await ok("addStepDependency", {
      dependencyId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      beforeStepId: r.dice,
      afterStepId: r.strain,
    });
    const before = await revisionState(r.recipeId);

    const res = await mutate("addStepDependency", {
      dependencyId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      beforeStepId: r.strain,
      afterStepId: r.dice,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "INVALID_ARGS",
      message: "This would make a cycle: Dice the shallots → Strain → Dice the shallots",
    });
    expect(await revisionState(r.recipeId)).toEqual(before);
  });
});
