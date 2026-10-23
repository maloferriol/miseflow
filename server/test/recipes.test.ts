import { ingredientAliases, recipeRevisions, recipes } from "@miseflow/shared";
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

beforeAll(async () => {
  await loadSeed(db);
});

afterAll(async () => {
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
    const theirs = crypto.randomUUID();
    await db
      .insert(recipes)
      .values({ id: theirs, ownerId: crypto.randomUUID(), name: "Not yours" });

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
    const theirs = crypto.randomUUID();
    await db
      .insert(recipes)
      .values({ id: theirs, ownerId: crypto.randomUUID(), name: "Not yours" });

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
