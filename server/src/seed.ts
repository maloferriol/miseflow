import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  conversions,
  ingredientAliases,
  ingredients,
  normaliseName,
  positionAfter,
  shoppingCategories,
} from "@miseflow/shared";
import { and, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "./db.ts";

// The shared, read-only Ingredient seed (ADR 0003, ADR 0010). `seed.json` holds the licence
// notice, which covers every file in the folder, and the Shopping categories in their order.
// `ingredients/<category>.json` holds each Shopping category's Ingredients, so tickets that grow
// different categories never edit the same file.
const seedDir = fileURLToPath(new URL("../seed", import.meta.url));

const kind = z.enum(["mass", "volume", "count"]);
const ingredientSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  fdcId: z.string().nullable(),
  preferredKind: kind,
  shoppingCategory: z.string(),
  aliases: z.array(z.strictObject({ id: z.uuid(), name: z.string().min(1) })),
  conversions: z.array(
    z.strictObject({
      id: z.uuid(),
      fromUnit: z.string(),
      toUnit: z.string(),
      factor: z.number().positive(),
      // Where the reference value came from; not stored, the row keeps only its values.
      fdcId: z.string().nullable(),
    }),
  ),
});
const headSchema = z.strictObject({
  licence: z.strictObject({ notice: z.string(), odbl: z.url(), dbcl: z.url() }),
  shoppingCategories: z.array(z.strictObject({ id: z.uuid(), name: z.string().min(1) })),
});

export type Seed = z.infer<typeof headSchema> & { ingredients: z.infer<typeof ingredientSchema>[] };

/** The file a Shopping category's Ingredients live in: "Meat & fish" → "meat-and-fish.json". */
function categoryFile(category: string): string {
  const slug = category
    .toLowerCase()
    .replaceAll("&", "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}.json`;
}

/**
 * Reads and merges the seed folder. Throws, naming the clash, when an id appears twice, an
 * Ingredient sits in a file that isn't its Shopping category, or two Ingredients' names or
 * aliases match once normalised the way catalog matching does.
 */
export function readSeed(dir: string = seedDir): Seed {
  const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
  const head = headSchema.parse(readJson(join(dir, "seed.json")));
  const files = new Map(head.shoppingCategories.map((c) => [categoryFile(c.name), c.name]));

  const ingredientsDir = join(dir, "ingredients");
  const present = new Set(readdirSync(ingredientsDir).filter((name) => name.endsWith(".json")));
  for (const file of present) {
    if (!files.has(file)) throw new Error(`seed: ${file} names no Shopping category`);
  }
  // In Shopping category order, so the merged seed reads the same on every machine.
  const fileNames = [...files.keys()].filter((file) => present.has(file));

  const ids = new Map<string, string>();
  const claim = (id: string, what: string) => {
    const earlier = ids.get(id);
    if (earlier) throw new Error(`seed: id ${id} appears twice: ${earlier} and ${what}`);
    ids.set(id, what);
  };
  for (const category of head.shoppingCategories) {
    claim(category.id, `Shopping category ${category.name} (seed.json)`);
  }

  const names = new Map<string, string>();
  const ingredientsRead: Seed["ingredients"] = [];
  for (const file of fileNames) {
    const rows = z.array(ingredientSchema).parse(readJson(join(ingredientsDir, file)));
    for (const ingredient of rows) {
      if (ingredient.shoppingCategory !== files.get(file)) {
        throw new Error(
          `seed: ${ingredient.name} is in ${file}, but its Shopping category is ${ingredient.shoppingCategory}`,
        );
      }
      claim(ingredient.id, `Ingredient ${ingredient.name} (${file})`);
      for (const alias of ingredient.aliases) {
        claim(alias.id, `alias ${alias.name} of ${ingredient.name} (${file})`);
      }
      for (const conversion of ingredient.conversions) {
        claim(conversion.id, `Conversion of ${ingredient.name} (${file})`);
      }

      // An Ingredient's own name and aliases may normalise the same; two Ingredients may not.
      const own = new Map<string, string>();
      for (const name of [ingredient.name, ...ingredient.aliases.map((a) => a.name)]) {
        own.set(normaliseName(name), `"${name}" (${ingredient.name})`);
      }
      for (const [key, what] of own) {
        const earlier = names.get(key);
        if (earlier) throw new Error(`seed: ${earlier} and ${what} match as "${key}"`);
        names.set(key, what);
      }
      ingredientsRead.push(ingredient);
    }
  }
  return { ...head, ingredients: ingredientsRead };
}

export type SeedResult = {
  shoppingCategories: number;
  ingredients: number;
  aliases: number;
  conversions: number;
  /** Rows inserted or changed. 0 when the database already matches the file. */
  written: number;
};

/**
 * Upserts every seed row with no owner and `source = 'seed'`, in one transaction. A row is
 * rewritten only when it differs from the file, so a second run writes nothing and keeps
 * `updated_at`. Rows dropped from the file are left alone.
 */
export async function loadSeed(db: Db, seed: Seed = readSeed()): Promise<SeedResult> {
  const categoryIds = new Map<string, string>();
  let position: string | null = null;
  const categoryRows = seed.shoppingCategories.map((category) => {
    position = positionAfter(position);
    categoryIds.set(category.name, category.id);
    return {
      id: category.id,
      ownerId: null,
      name: category.name,
      position,
      deletedAt: null,
    };
  });

  const ingredientRows = seed.ingredients.map((ingredient) => {
    const shoppingCategoryId = categoryIds.get(ingredient.shoppingCategory);
    if (!shoppingCategoryId) {
      throw new Error(
        `${ingredient.name}: unknown Shopping category ${ingredient.shoppingCategory}`,
      );
    }
    return {
      id: ingredient.id,
      ownerId: null,
      name: ingredient.name,
      fdcId: ingredient.fdcId,
      source: "seed" as const,
      preferredKind: ingredient.preferredKind,
      // Null: the kitchen's Main unit for the Ingredient's kind of measure.
      mainUnit: null,
      shoppingCategoryId,
      deletedAt: null,
    };
  });
  const aliasRows = seed.ingredients.flatMap((ingredient) =>
    ingredient.aliases.map((alias) => ({
      id: alias.id,
      ownerId: null,
      ingredientId: ingredient.id,
      name: alias.name,
      source: "seed" as const,
      deletedAt: null,
    })),
  );
  const conversionRows = seed.ingredients.flatMap((ingredient) =>
    ingredient.conversions.map((conversion) => ({
      id: conversion.id,
      ownerId: null,
      ingredientId: ingredient.id,
      fromUnit: conversion.fromUnit,
      toUnit: conversion.toUnit,
      factor: String(conversion.factor),
      source: "seed" as const,
      deletedAt: null,
    })),
  );

  const written = await db.transaction(async (tx) => {
    let count = 0;
    count += await upsert(tx, shoppingCategories, categoryRows, [
      shoppingCategories.ownerId,
      shoppingCategories.name,
      shoppingCategories.position,
      shoppingCategories.deletedAt,
    ]);
    count += await upsert(tx, ingredients, ingredientRows, [
      ingredients.ownerId,
      ingredients.name,
      ingredients.fdcId,
      ingredients.source,
      ingredients.preferredKind,
      ingredients.mainUnit,
      ingredients.shoppingCategoryId,
      ingredients.deletedAt,
    ]);
    count += await upsert(tx, ingredientAliases, aliasRows, [
      ingredientAliases.ownerId,
      ingredientAliases.ingredientId,
      ingredientAliases.name,
      ingredientAliases.source,
      ingredientAliases.deletedAt,
    ]);
    count += await upsert(tx, conversions, conversionRows, [
      conversions.ownerId,
      conversions.ingredientId,
      conversions.fromUnit,
      conversions.toUnit,
      conversions.factor,
      conversions.source,
      conversions.deletedAt,
    ]);
    return count;
  });

  return {
    shoppingCategories: categoryRows.length,
    ingredients: ingredientRows.length,
    aliases: aliasRows.length,
    conversions: conversionRows.length,
    written,
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// insert … on conflict (id) do update set <columns> = excluded.<columns>, updated_at = now()
// where owner_id is null and (<columns>) is distinct from (excluded.<columns>). Returns the rows
// written. A user's row that already holds a seed id is never taken over: the load throws, and
// the caller's transaction rolls back.
// Source: https://orm.drizzle.team/docs/insert#on-conflict-do-update
async function upsert<T extends PgTable & { id: PgColumn; ownerId: PgColumn }>(
  tx: Tx,
  table: T,
  rows: (T["$inferInsert"] & { id: string })[],
  columns: PgColumn[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const excluded = (column: PgColumn) => sql`excluded.${sql.identifier(column.name)}`;
  const set: Record<string, SQL> = { updatedAt: sql`now()` };
  for (const column of columns) set[keyOf(table, column)] = excluded(column);
  const written = await tx
    .insert(table)
    .values(rows)
    .onConflictDoUpdate({
      target: table.id,
      set,
      setWhere: sql`${table.ownerId} is null and (${sql.join(columns, sql`, `)}) is distinct from (${sql.join(
        columns.map(excluded),
        sql`, `,
      )})`,
    })
    .returning({ id: table.id });
  const [owned] = await tx
    .select({ id: table.id })
    // Widening the generic T skips Drizzle's conditional check on the table type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    .from(table as PgTable)
    .where(
      and(
        inArray(
          table.id,
          rows.map((row) => row.id),
        ),
        isNotNull(table.ownerId),
      ),
    )
    .limit(1);
  if (owned) throw new Error(`${String(owned.id)} is not a seed row: it belongs to a user`);
  return written.length;
}

// The table's property name for a column (`ownerId` for "owner_id").
function keyOf(table: PgTable, column: PgColumn): string {
  const entry = Object.entries(table).find(([, value]) => value === column);
  if (!entry) throw new Error(`${column.name} is not a column of this table`);
  return entry[0];
}
