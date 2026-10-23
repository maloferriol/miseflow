import { readFileSync } from "node:fs";
import {
  conversions,
  ingredientAliases,
  ingredients,
  positionAfter,
  shoppingCategories,
} from "@miseflow/shared";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "./db.ts";

// The shared, read-only Ingredient seed (ADR 0003, ADR 0010). Its data licence and
// notice live in the seed file itself, which covers that file only.
const seedFile = new URL("../seed/ingredient-seed.json", import.meta.url);

const kind = z.enum(["mass", "volume", "count"]);
const seedSchema = z.strictObject({
  licence: z.strictObject({ notice: z.string(), odbl: z.url(), dbcl: z.url() }),
  shoppingCategories: z.array(
    z.strictObject({ id: z.uuid(), name: z.string().min(1) }),
  ),
  ingredients: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string().min(1),
      fdcId: z.string().nullable(),
      preferredKind: kind,
      shoppingCategory: z.string(),
      aliases: z.array(
        z.strictObject({ id: z.uuid(), name: z.string().min(1) }),
      ),
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
    }),
  ),
});

export type Seed = z.infer<typeof seedSchema>;

export function readSeed(): Seed {
  return seedSchema.parse(JSON.parse(readFileSync(seedFile, "utf8")));
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
export async function loadSeed(
  db: Db,
  seed: Seed = readSeed(),
): Promise<SeedResult> {
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
// where (<columns>) is distinct from (excluded.<columns>). Returns the rows written.
// Source: https://orm.drizzle.team/docs/insert#on-conflict-do-update
async function upsert<T extends PgTable & { id: PgColumn }>(
  tx: Tx,
  table: T,
  rows: T["$inferInsert"][],
  columns: PgColumn[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const excluded = (column: PgColumn) =>
    sql`excluded.${sql.identifier(column.name)}`;
  const set: Record<string, SQL> = { updatedAt: sql`now()` };
  for (const column of columns) set[keyOf(table, column)] = excluded(column);
  const written = await tx
    .insert(table)
    .values(rows)
    .onConflictDoUpdate({
      target: table.id,
      set,
      setWhere: sql`(${sql.join(columns, sql`, `)}) is distinct from (${sql.join(
        columns.map(excluded),
        sql`, `,
      )})`,
    })
    .returning({ id: table.id });
  return written.length;
}

// The table's property name for a column (`ownerId` for "owner_id").
function keyOf(table: PgTable, column: PgColumn): string {
  const entry = Object.entries(table).find(([, value]) => value === column);
  if (!entry) throw new Error(`${column.name} is not a column of this table`);
  return entry[0];
}
