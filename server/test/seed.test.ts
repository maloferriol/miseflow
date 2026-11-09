import {
  conversions,
  findIngredient,
  ingredientAliases,
  ingredients,
  shoppingCategories,
} from "@miseflow/shared";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
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
    const missing = walkthrough.filter((name) => !findIngredient(catalog, name));
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
    await db
      .insert(ingredients)
      .values({ id, ownerId: crypto.randomUUID(), name: "Theirs", source: "own" });
    const [before] = await db.select().from(ingredients).where(eq(ingredients.id, id));
    const seed = readSeed();
    const extra = {
      ...seed.ingredients[0],
      id,
      name: "seeded over theirs",
      aliases: [],
      conversions: [],
    };

    try {
      await expect(
        loadSeed(db, { ...seed, ingredients: [...seed.ingredients, extra] }),
      ).rejects.toThrow(/not a seed row/);
      expect(await db.select().from(ingredients).where(eq(ingredients.id, id))).toEqual([before]);
    } finally {
      await db
        .update(ingredients)
        .set({ deletedAt: sql`now()` })
        .where(eq(ingredients.id, id));
    }
  });
});

type SeedIngredient = ReturnType<typeof readSeed>["ingredients"][number];

describe("readSeed", () => {
  const copies: string[] = [];
  afterEach(() => {
    for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // A copy of the seed folder, so a test can break one file without touching the real seed.
  function seedCopy() {
    const dir = mkdtempSync(join(tmpdir(), "miseflow-seed-"));
    copies.push(dir);
    cpSync(fileURLToPath(new URL("../seed", import.meta.url)), dir, { recursive: true });
    const path = (file: string) => join(dir, "ingredients", file);
    return {
      dir,
      read: (file: string) => JSON.parse(readFileSync(path(file), "utf8")) as SeedIngredient[],
      write: (file: string, rows: SeedIngredient[]) =>
        writeFileSync(path(file), JSON.stringify(rows, null, 2)),
    };
  }

  // Loads the copy into a database already seeded, and checks the load wrote nothing.
  async function expectRefused(dir: string, message: RegExp) {
    await loadSeed(db);
    const before = await seedRows();
    await expect(async () => loadSeed(db, readSeed(dir))).rejects.toThrow(message);
    expect(await seedRows()).toEqual(before);
  }

  const ingredient = (overrides: Partial<SeedIngredient>): SeedIngredient => ({
    id: crypto.randomUUID(),
    name: "test ingredient",
    fdcId: null,
    preferredKind: "mass",
    shoppingCategory: "Spices",
    aliases: [],
    conversions: [],
    ...overrides,
  });

  it("merges the category files into the whole seed", () => {
    const seed = readSeed();
    // Every category file read directly, so the seed-growth tickets don't each move a total.
    const dir = fileURLToPath(new URL("../seed/ingredients", import.meta.url));
    const rows = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as SeedIngredient[]);

    expect(seed.shoppingCategories).toHaveLength(9);
    expect(seed.ingredients).toHaveLength(rows.length);
    expect(seed.ingredients.flatMap((i) => i.aliases)).toHaveLength(
      rows.flatMap((i) => i.aliases).length,
    );
    expect(seed.ingredients.flatMap((i) => i.conversions)).toHaveLength(
      rows.flatMap((i) => i.conversions).length,
    );
  });

  it("refuses an id used in two category files", async () => {
    const copy = seedCopy();
    const [carrot] = copy.read("produce.json");
    copy.write("spices.json", [
      ...copy.read("spices.json"),
      ingredient({ id: carrot.id, name: "grains of paradise" }),
    ]);

    await expectRefused(copy.dir, new RegExp(`${carrot.id} appears twice`));
  });

  it("refuses an Ingredient in a file that isn't its Shopping category", async () => {
    const copy = seedCopy();
    copy.write("spices.json", [
      ...copy.read("spices.json"),
      ingredient({ name: "grains of paradise", shoppingCategory: "Produce" }),
    ]);

    await expectRefused(
      copy.dir,
      /grains of paradise is in spices\.json, but its Shopping category is Produce/,
    );
  });

  it("refuses two Ingredients whose names or aliases normalise the same", async () => {
    const copy = seedCopy();
    copy.write("spices.json", [
      ...copy.read("spices.json"),
      ingredient({
        name: "grains of paradise",
        aliases: [{ id: crypto.randomUUID(), name: "Onion" }],
      }),
    ]);

    await expectRefused(copy.dir, /"onion" \(onion\) and "Onion" \(grains of paradise\)/);
  });
});
