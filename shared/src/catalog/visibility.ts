import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { NotFoundError, type Tx } from "../mutators/define.ts";
import { conversions, ingredientAliases, ingredients, shoppingCategories } from "../schema.ts";

// Which catalog rows a kitchen sees (ADR 0010): a live row that is a seed row or the owner's own.
// A seed row has no owner and `source = 'seed'`; Shopping categories have no `source`, so any
// ownerless one is a seed row. Soft-deleted rows never show.

export type CatalogTable =
  typeof ingredients | typeof ingredientAliases | typeof conversions | typeof shoppingCategories;

/** The `where` for a catalog read: the rows of `table` visible to `ownerId`. */
export function visibleTo(table: CatalogTable, ownerId: string): SQL {
  const seed =
    "source" in table
      ? and(isNull(table.ownerId), eq(table.source, "seed"))
      : isNull(table.ownerId);
  return and(or(seed, eq(table.ownerId, ownerId)), isNull(table.deletedAt))!;
}

/** A seed Ingredient, or the caller's own live one; anything else reads as missing. */
export async function requireVisibleIngredient(tx: Tx, id: string, ownerId: string) {
  const [row] = await tx
    .select({
      id: ingredients.id,
      source: ingredients.source,
      preferredKind: ingredients.preferredKind,
    })
    .from(ingredients)
    .where(and(eq(ingredients.id, id), visibleTo(ingredients, ownerId)));
  if (!row) throw new NotFoundError("Ingredient");
  return row;
}

/** Every Ingredient must be visible to the caller; anything else reads as missing. */
export async function requireVisibleIngredients(tx: Tx, ownerId: string, ids: string[]) {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return;
  const rows = await tx
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(and(inArray(ingredients.id, wanted), visibleTo(ingredients, ownerId)));
  if (rows.length !== wanted.length) throw new NotFoundError("Ingredient");
}

/** A seed Shopping category, or the caller's own live one; anything else reads as missing. */
export async function requireVisibleCategory(tx: Tx, id: string, ownerId: string) {
  const [row] = await tx
    .select({ id: shoppingCategories.id })
    .from(shoppingCategories)
    .where(and(eq(shoppingCategories.id, id), visibleTo(shoppingCategories, ownerId)));
  if (!row) throw new NotFoundError("Shopping category");
}
