import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "../mutators/define.ts";
import {
  ingredientAliases,
  ingredientOverrides,
  ingredients,
  shoppingCategories,
} from "../schema.ts";
import type { CatalogEntry } from "./match.ts";
import { visibleTo } from "./visibility.ts";

export type VisibleIngredient = CatalogEntry & {
  preferredKind: string | null;
  /** The caller's override if any, else the Ingredient's own value (null: the kitchen's unit). */
  mainUnit: string | null;
  shoppingCategory: { id: string; name: string } | null;
  overridden: boolean;
  /** The id of the caller's override row for this Ingredient, if one exists. */
  overrideId: string | null;
};

/** The Ingredient catalog the caller sees: the seed plus their own rows, overrides merged in. */
export async function loadCatalog(tx: Tx, ownerId: string): Promise<VisibleIngredient[]> {
  const [ingredientRows, aliasRows, overrideRows, categoryRows] = await Promise.all([
    tx.select().from(ingredients).where(visibleTo(ingredients, ownerId)),
    tx
      .select({
        ingredientId: ingredientAliases.ingredientId,
        name: ingredientAliases.name,
        source: ingredientAliases.source,
      })
      .from(ingredientAliases)
      .where(visibleTo(ingredientAliases, ownerId)),
    tx
      .select()
      .from(ingredientOverrides)
      .where(and(eq(ingredientOverrides.ownerId, ownerId), isNull(ingredientOverrides.deletedAt))),
    tx
      .select({ id: shoppingCategories.id, name: shoppingCategories.name })
      .from(shoppingCategories)
      .where(visibleTo(shoppingCategories, ownerId)),
  ]);

  const categories = new Map(categoryRows.map((c) => [c.id, c]));
  const overrides = new Map(overrideRows.map((o) => [o.ingredientId, o]));
  const aliases = new Map<string, typeof aliasRows>();
  for (const alias of aliasRows) {
    aliases.set(alias.ingredientId, [...(aliases.get(alias.ingredientId) ?? []), alias]);
  }

  return ingredientRows.map((row) => {
    const override = overrides.get(row.id);
    const categoryId = override?.shoppingCategoryId ?? row.shoppingCategoryId;
    return {
      id: row.id,
      name: row.name,
      source: row.source,
      aliases: (aliases.get(row.id) ?? []).map(({ name, source }) => ({
        name,
        source,
      })),
      preferredKind: row.preferredKind,
      mainUnit: override?.mainUnit ?? row.mainUnit,
      shoppingCategory: (categoryId && categories.get(categoryId)) || null,
      overridden:
        !!override && (override.mainUnit !== null || override.shoppingCategoryId !== null),
      overrideId: override?.id ?? null,
    };
  });
}
