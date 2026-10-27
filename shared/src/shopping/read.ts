import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { loadCatalog } from "../catalog/load.ts";
import type { Tx } from "../mutators/define.ts";
import { loadScaleRows } from "../plan/batch-rows.ts";
import { deriveScale } from "../plan/model.ts";
import { findLiveService } from "../plan/replan.ts";
import type { RecipeSnapshot } from "../recipe/snapshot.ts";
import { conversions, kitchenSettings, shoppingCategories, shoppingMarks } from "../schema.ts";
import { type ConversionRow, deriveShoppingList, type ShoppingList } from "./list.ts";

export type ShoppingListRead = ShoppingList & { service: { id: string; menuId: string } };

/**
 * One Service's Shopping list, derived on read (ADR 0010): its Menu's Dishes and Batches scaled as
 * the Plan scales them, the caller's catalog with overrides, the visible Conversions, categories
 * in position order, and the Service's live Got marks. Reads only.
 */
export async function readShoppingList(
  tx: Tx,
  ownerId: string,
  serviceId: string,
): Promise<ShoppingListRead> {
  const service = await findLiveService(tx, ownerId, serviceId);
  const rows = await loadScaleRows(tx, ownerId, service.menuId);
  const recipes = new Map<string, RecipeSnapshot>(rows.subRecipes);
  for (const d of rows.dishes) recipes.set(d.recipeId, d.recipe);

  const visible = (table: typeof shoppingCategories | typeof conversions) =>
    and(or(isNull(table.ownerId), eq(table.ownerId, ownerId)), isNull(table.deletedAt));
  const [catalog, categories, [settings], conversionRows, marks] = await Promise.all([
    loadCatalog(tx, ownerId),
    tx
      .select({ id: shoppingCategories.id, name: shoppingCategories.name })
      .from(shoppingCategories)
      .where(visible(shoppingCategories))
      .orderBy(asc(sql`${shoppingCategories.position} collate "C"`), asc(shoppingCategories.id)),
    tx
      .select({
        mass: kitchenSettings.massUnit,
        volume: kitchenSettings.volumeUnit,
        count: kitchenSettings.countUnit,
      })
      .from(kitchenSettings)
      .where(and(eq(kitchenSettings.ownerId, ownerId), isNull(kitchenSettings.deletedAt)))
      .orderBy(asc(kitchenSettings.id))
      .limit(1),
    tx
      .select({
        ingredientId: conversions.ingredientId,
        fromUnit: conversions.fromUnit,
        toUnit: conversions.toUnit,
        factor: conversions.factor,
        source: conversions.source,
      })
      .from(conversions)
      .where(visible(conversions))
      .orderBy(asc(conversions.id)),
    tx
      .select({ ingredientId: shoppingMarks.ingredientId })
      .from(shoppingMarks)
      .where(
        and(
          eq(shoppingMarks.serviceId, serviceId),
          eq(shoppingMarks.ownerId, ownerId),
          eq(shoppingMarks.status, "got"),
          isNull(shoppingMarks.deletedAt),
        ),
      ),
  ]);

  const byIngredient = new Map<string, ConversionRow[]>();
  for (const { ingredientId, factor, ...row } of conversionRows)
    byIngredient.set(ingredientId, [
      ...(byIngredient.get(ingredientId) ?? []),
      { ...row, factor: Number(factor) },
    ]);

  const list = deriveShoppingList({
    region: rows.region,
    dishes: rows.dishes,
    recipes,
    scale: deriveScale(rows),
    catalog,
    categories,
    kitchenUnits: settings ?? { mass: "g", volume: "ml", count: "each" },
    conversions: (id) => byIngredient.get(id) ?? [],
    got: new Set(marks.map((m) => m.ingredientId)),
  });
  return { service: { id: service.id, menuId: service.menuId }, ...list };
}
