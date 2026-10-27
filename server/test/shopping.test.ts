import { batches, menus, recipes, services, shoppingMarks } from "@miseflow/shared";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  type Walkthrough,
} from "../../shared/test/walkthrough.ts";
import { loadSeed, readSeed } from "../src/seed.ts";
import { db, getToken, testApp } from "./helpers.ts";

async function send(method: "GET" | "POST", path: string, body?: unknown) {
  return testApp().request(path, {
    method,
    headers: { Authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ok(name: string, args: Record<string, unknown>) {
  const res = await send("POST", "/mutate", { id: crypto.randomUUID(), name, args });
  expect(res.status, await res.clone().text()).toBe(200);
}

// The seed's Ingredient ids by name, for the walkthrough's lines.
const seedId = (name: string) => readSeed().ingredients.find((i) => i.name === name)!.id;
const ids = {
  shallot: seedId("shallot"),
  butter: seedId("butter"),
  flour: seedId("all-purpose flour"),
  salt: seedId("salt"),
  apple: seedId("apple"),
  sugar: seedId("sugar"),
};

// What this file made, soft-deleted afterwards.
const serviceId = crypto.randomUUID();
const theirMenuId = crypto.randomUUID();
const theirServiceId = crypto.randomUUID();
const s = crypto.randomUUID().slice(0, 8);
let w: Walkthrough;
afterAll(async () => {
  await db
    .update(shoppingMarks)
    .set({ deletedAt: sql`now()` })
    .where(inArray(shoppingMarks.serviceId, [serviceId]));
  await db
    .update(services)
    .set({ deletedAt: sql`now()` })
    .where(inArray(services.id, [serviceId, theirServiceId]));
  await db
    .update(menus)
    .set({ deletedAt: sql`now()` })
    .where(inArray(menus.id, [theirMenuId]));
  if (!w) return;
  await db
    .update(batches)
    .set({ deletedAt: sql`now()` })
    .where(inArray(batches.serviceId, [serviceId]));
  await db
    .update(menus)
    .set({ deletedAt: sql`now()` })
    .where(inArray(menus.id, [w.menuId]));
  await db
    .update(recipes)
    .set({ deletedAt: sql`now()` })
    .where(inArray(recipes.id, Object.values(w.recipes) as string[]));
});

beforeAll(async () => {
  await loadSeed(db);
  w = await buildWalkthrough(ok, s, { shopping: ids });
  await ok("createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
  // Another owner's Menu and Service, written directly.
  const owner = crypto.randomUUID();
  await db.insert(menus).values({ id: theirMenuId, ownerId: owner, name: "Theirs" });
  await db
    .insert(services)
    .values({ id: theirServiceId, ownerId: owner, menuId: theirMenuId, date: SERVICE_DATE });
});

describe("GET /services/:serviceId/shopping-list", () => {
  it("GET /services/:id/shopping-list returns the walkthrough's rows grouped by category, with Got marks", async () => {
    await ok("markGot", { markId: crypto.randomUUID(), serviceId, ingredientId: ids.butter });
    await ok("markGot", { markId: crypto.randomUUID(), serviceId, ingredientId: ids.apple });
    await ok("unmarkGot", { serviceId, ingredientId: ids.apple });

    const res = await send("GET", `/services/${serviceId}/shopping-list`);
    expect(res.status).toBe(200);
    const { shoppingList } = await res.json();
    expect(shoppingList.service).toEqual({ id: serviceId, menuId: w.menuId });
    type Row = {
      name: string;
      need: number | null;
      unit: string | null;
      approximate: boolean;
      vague: string[];
      got: boolean;
    };
    expect(
      shoppingList.categories.map((c: { name: string; rows: Row[] }) => [
        c.name,
        c.rows.map((r) => [r.name, r.need, r.unit, r.approximate, r.vague, r.got]),
      ]),
    ).toEqual([
      [
        "Produce",
        [
          ["apple", 6, "each", false, [], false],
          ["shallot", 150, "g", false, [], false],
        ],
      ],
      ["Dairy & eggs", [["butter", 300, "g", false, [], true]]],
      [
        "Dry goods",
        [
          ["all-purpose flour", 200, "g", false, [], false],
          ["sugar", 150, "g", false, [], false],
        ],
      ],
      ["Spices", [["salt", null, "g", false, ["a pinch"], false]]],
    ]);
    expect(shoppingList.missing).toEqual([]);
  });

  it("is 404 for another owner's Service or a bad id", async () => {
    for (const id of [theirServiceId, crypto.randomUUID(), "not-a-uuid"]) {
      const res = await send("GET", `/services/${id}/shopping-list`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    }
  });
});
