import { batches, menus, recipes, services } from "@miseflow/shared";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../../shared/test/walkthrough.ts";
import { db, getToken, testApp } from "./helpers.ts";

async function send(method: "GET" | "POST", path: string, body?: unknown) {
  return testApp().request(path, {
    method,
    headers: { Authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const mutate = (name: string, args: Record<string, unknown>) =>
  send("POST", "/mutate", { id: crypto.randomUUID(), name, args });

async function ok(name: string, args: Record<string, unknown>) {
  const res = await mutate(name, args);
  expect(res.status, await res.clone().text()).toBe(200);
}

async function read(path: string) {
  const res = await send("GET", path);
  expect(res.status).toBe(200);
  return res.json();
}

// What this file made, soft-deleted afterwards. Overwrites the test user's Availability.
const serviceId = crypto.randomUUID();
const s = crypto.randomUUID().slice(0, 8);
let w: Walkthrough;
afterAll(async () => {
  if (!w) return;
  await db
    .update(batches)
    .set({ deletedAt: sql`now()` })
    .where(inArray(batches.serviceId, [serviceId]));
  await db
    .update(services)
    .set({ deletedAt: sql`now()` })
    .where(inArray(services.id, [serviceId]));
  await db
    .update(menus)
    .set({ deletedAt: sql`now()` })
    .where(inArray(menus.id, [w.menuId]));
  await db
    .update(recipes)
    .set({ deletedAt: sql`now()` })
    .where(inArray(recipes.id, Object.values<string>(w.recipes)));
});

beforeAll(async () => {
  w = await buildWalkthrough(ok, s, { stock: true });
  await setWalkthroughAvailability(ok);
  await ok("createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
});

const label = () => `Chicken stock ${s} ×1.5 · for: Velouté ${s}, Beurre blanc ${s}`;

describe("Batches in the reads", () => {
  it("the Menu read lists one stock Batch with its label, and each Dish's Scale factor", async () => {
    const { menu } = await read(`/menus/${w.menuId}`);
    const stock = menu.batches.filter(
      (b: { subRecipe: { id: string } }) => b.subRecipe.id === w.recipes.stock,
    );
    expect(stock).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        label: label(),
        factor: 1.5,
        scalable: true,
        fix: null,
      }),
    ]);
    const veloute = menu.courses[0].dishes[0];
    expect(veloute).toMatchObject({
      id: w.dishes.veloute,
      scale: { factor: 1.5, source: "guests" },
      fixes: [],
    });
  });

  it("the Plan read has the stock's Tasks on Thursday 29 October with the Batch label", async () => {
    const { plan } = await read(`/services/${serviceId}/plan`);
    const thursday = plan.days.find((d: { date: string }) => d.date === "2026-10-29");
    const stockTasks = thursday.tasks.filter(
      (t: { batch: { label: string } | null }) => t.batch?.label === label(),
    );
    expect(stockTasks.map((t: { steps: { text: string }[] }) => t.steps[0].text)).toEqual([
      "Roast the bones",
      "Simmer the stock",
      "Strain the stock",
    ]);
    expect(stockTasks.every((t: { dish: unknown }) => t.dish === null)).toBe(true);
    expect(plan.conflicts).toEqual([]);
  });

  it("answers 400 to portions on a Recipe with no servings", async () => {
    const res = await mutate("setDishScale", {
      dishId: w.dishes.tarte,
      scale: { kind: "portions", portions: 8 },
    });
    expect(res.status).toBe(400);
  });

  it("after the stock's yield is cleared, the Menu's Dishes carry add a yield", async () => {
    await ok("setYield", {
      recipeId: w.recipes.stock,
      revisionId: crypto.randomUUID(),
      yield: null,
    });
    const { menu } = await read(`/menus/${w.menuId}`);
    const fix = {
      subRecipe: { id: w.recipes.stock, name: `Chicken stock ${s}` },
      text: "add a yield",
    };
    const dishes = menu.courses.flatMap((c: { dishes: unknown[] }) => c.dishes);
    expect(dishes.find((d: { id: string }) => d.id === w.dishes.veloute).fixes).toEqual([fix]);
    expect(dishes.find((d: { id: string }) => d.id === w.dishes.duck).fixes).toEqual([fix]);
  });
});
