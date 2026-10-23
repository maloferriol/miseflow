import {
  conversions,
  findIngredient,
  ingredientAliases,
  ingredients,
  shoppingCategories,
} from "@miseflow/shared";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadSeed, readSeed } from "../src/seed.ts";
import { db } from "./helpers.ts";

// Every seed row, in id order, so two reads compare equal when nothing changed.
async function seedRows() {
  return {
    categories: await db
      .select()
      .from(shoppingCategories)
      .where(isNull(shoppingCategories.ownerId))
      .orderBy(asc(shoppingCategories.id)),
    ingredients: await db
      .select()
      .from(ingredients)
      .where(isNull(ingredients.ownerId))
      .orderBy(asc(ingredients.id)),
    aliases: await db
      .select()
      .from(ingredientAliases)
      .where(isNull(ingredientAliases.ownerId))
      .orderBy(asc(ingredientAliases.id)),
    conversions: await db
      .select()
      .from(conversions)
      .where(isNull(conversions.ownerId))
      .orderBy(asc(conversions.id)),
  };
}

describe("loadSeed", () => {
  it("loads the nine Shopping categories in spec order", async () => {
    await loadSeed(db);

    const rows = await db
      .select({ name: shoppingCategories.name })
      .from(shoppingCategories)
      .where(isNull(shoppingCategories.ownerId))
      .orderBy(asc(sql`${shoppingCategories.position} collate "C"`));
    expect(rows.map((r) => r.name)).toEqual([
      "Produce",
      "Meat & fish",
      "Dairy & eggs",
      "Bakery",
      "Dry goods",
      "Spices",
      "Frozen",
      "Drinks",
      "Other",
    ]);
  });

  it("holds every Ingredient the Done walkthrough names", async () => {
    await loadSeed(db);
    const { ingredients: rows, aliases } = await seedRows();
    const catalog = rows.map((row) => ({
      id: row.id,
      name: row.name,
      source: row.source,
      aliases: aliases.filter((a) => a.ingredientId === row.id),
    }));

    const walkthrough = [
      "chicken carcass",
      "onions",
      "carrots",
      "leek",
      "celery",
      "garlic",
      "bay leaves",
      "thyme",
      "parsley",
      "black peppercorns",
      "white pepper",
      "butter",
      "flour",
      "cream",
      "milk",
      "eggs",
      "salt",
      "sugar",
      "white wine",
      "white wine vinegar",
      "shallots",
      "duck breast",
      "apples",
      "water",
    ];
    const missing = walkthrough.filter(
      (name) => !findIngredient(catalog, name),
    );
    expect(missing).toEqual([]);
    expect(rows.every((row) => row.source === "seed")).toBe(true);
  });

  it("changes nothing when run a second time", async () => {
    await loadSeed(db);
    const before = await seedRows();

    const second = await loadSeed(db);

    expect(second.written).toBe(0);
    expect(await seedRows()).toEqual(before);
  });

  it("refuses to take over a user's row that holds a seed id, and rolls back", async () => {
    const id = crypto.randomUUID();
    await db.insert(ingredients).values({ id, ownerId: crypto.randomUUID(), name: "Theirs", source: "own" });
    const [before] = await db.select().from(ingredients).where(eq(ingredients.id, id));
    const seed = readSeed();
    const extra = { ...seed.ingredients[0]!, id, name: "seeded over theirs", aliases: [], conversions: [] };

    try {
      await expect(loadSeed(db, { ...seed, ingredients: [...seed.ingredients, extra] })).rejects.toThrow(
        /not a seed row/,
      );
      expect(await db.select().from(ingredients).where(eq(ingredients.id, id))).toEqual([before]);
    } finally {
      await db.update(ingredients).set({ deletedAt: sql`now()` }).where(eq(ingredients.id, id));
    }
  });
});
