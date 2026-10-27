import { recipes } from "@miseflow/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
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

// The Recipes made here, soft-deleted afterwards.
const made: string[] = [];
afterAll(async () => {
  if (made.length)
    await db
      .update(recipes)
      .set({ deletedAt: sql`now()` })
      .where(inArray(recipes.id, made));
});

const stamp = () => crypto.randomUUID().slice(0, 8);

async function newRecipe(name: string, mutation = "createRecipe") {
  const recipeId = crypto.randomUUID();
  await ok(mutation, { recipeId, revisionId: crypto.randomUUID(), name });
  made.push(recipeId);
  return recipeId;
}

// Adds "Add @<wording>{<amount>}" to `recipeId`, its line using `subRecipeId`.
async function use(recipeId: string, subRecipeId: string, wording: string, amount = "1") {
  const lineId = crypto.randomUUID();
  return mutate("addStep", {
    recipeId,
    stepId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    body: [
      { type: "text", text: "Add " },
      { type: "line", lineId },
    ],
    lines: [{ lineId, subRecipeId, amount, wording }],
  });
}

async function read(recipeId: string) {
  const res = await send("GET", `/recipes/${recipeId}`);
  expect(res.status).toBe(200);
  return (await res.json()).recipe;
}

describe("GET /recipes/:id with sub-recipes", () => {
  it("names a line's sub-recipe, and lists who uses a Recipe that needs a yield until it has one", async () => {
    const s = stamp();
    const veloute = await newRecipe(`Velouté ${s}`);
    const stock = await newRecipe(`Chicken stock ${s}`, "createSubRecipe");
    expect((await use(veloute, stock, "chicken stock", "1.5%L")).status).toBe(200);

    const line = (await read(veloute)).steps[0].lines[0];
    expect(line).toMatchObject({
      subRecipe: { id: stock, name: `Chicken stock ${s}`, yield: null },
      missingSubRecipe: false,
      ingredient: null,
    });

    expect(await read(stock)).toMatchObject({
      yield: null,
      usedBy: [{ id: veloute, name: `Velouté ${s}` }],
      needsYield: true,
    });
    await ok("setYield", { recipeId: stock, revisionId: crypto.randomUUID(), yield: "2 L" });
    expect(await read(stock)).toMatchObject({
      yield: { quantity: 2, unit: "L" },
      needsYield: false,
    });

    const res = await send("GET", "/recipes");
    const listed = (await res.json()).recipes.find((r: { id: string }) => r.id === stock);
    expect(listed.yield).toEqual({ quantity: 2, unit: "L" });
  });

  it("reads a line whose sub-recipe was soft-deleted as a Missing sub-recipe, and the Recipe still opens", async () => {
    const s = stamp();
    const veloute = await newRecipe(`Velouté ${s}`);
    const stock = await newRecipe(`Chicken stock ${s}`, "createSubRecipe");
    expect((await use(veloute, stock, "chicken stock")).status).toBe(200);
    await db
      .update(recipes)
      .set({ deletedAt: sql`now()` })
      .where(eq(recipes.id, stock));

    const line = (await read(veloute)).steps[0].lines[0];
    expect(line).toMatchObject({
      subRecipe: null,
      missingSubRecipe: true,
      wording: "chicken stock",
    });
  });

  it("refuses a cycle through /mutate with 400 naming it, and writes nothing", async () => {
    const s = stamp();
    const veloute = await newRecipe(`Velouté ${s}`);
    const beurreBlanc = await newRecipe(`Beurre blanc ${s}`);
    expect((await use(beurreBlanc, veloute, "velouté")).status).toBe(200);

    const res = await use(veloute, beurreBlanc, "beurre blanc");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_ARGS");
    expect(body.error.message).toContain(`Velouté ${s} → Beurre blanc ${s} → Velouté ${s}`);
    expect((await read(veloute)).latestRevision).toBe(1);
  });
});
