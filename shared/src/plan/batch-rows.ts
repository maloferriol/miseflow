import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../mutators/define.ts";
import { loadSubRecipeGraph } from "../mutators/subrecipes.ts";
import type { Region } from "../recipe/convert.ts";
import { loadRecipeSnapshot, type RecipeSnapshot } from "../recipe/snapshot.ts";
import { batches, courses, dishes, kitchenSettings, menus, recipes, services } from "../schema.ts";
import { type BatchRead, type DishScale, toBatchRead } from "./batches.ts";
import { uuidV5 } from "./diff.ts";
import { deriveScale } from "./model.ts";

// Batch rows against the database: what a Menu's scaling reads, and the reconcile step re-plan runs.

// Batch ids are a UUID v5 of the Service and the sub-recipe (owner decision 4), under their own
// namespace, so the browser's optimistic re-plan (ADR 0010) makes the same rows. Flagged against
// ADR 0004 ("Ids are UUIDs created in the browser"); a revived row keeps its id.
const BATCH_NAMESPACE = "b3e1c0d4-5a7f-4c21-8e9b-7f2a6d4c1e58";

export function batchId(serviceId: string, subRecipeId: string): Promise<string> {
  return uuidV5(BATCH_NAMESPACE, `${serviceId}:${subRecipeId}`);
}

export type ScaleRows = {
  guestCount: number | null;
  region: Region;
  /** Live Dishes of live Courses and Recipes, in Menu order. */
  dishes: {
    dishId: string;
    recipeId: string;
    scaleFactor: number | null;
    recipe: RecipeSnapshot;
  }[];
  /** Every live sub-recipe the Dishes reach, by Recipe id. */
  subRecipes: Map<string, RecipeSnapshot>;
};

/** Everything a Menu's scaling reads: its guest count, the Unit region, the Dishes and their sub-recipes. */
export async function loadScaleRows(tx: Tx, ownerId: string, menuId: string): Promise<ScaleRows> {
  const [menu] = await tx
    .select({ guestCount: menus.guestCount })
    .from(menus)
    .where(and(eq(menus.id, menuId), eq(menus.ownerId, ownerId)));
  const [settings] = await tx
    .select({ unitRegion: kitchenSettings.unitRegion })
    .from(kitchenSettings)
    .where(and(eq(kitchenSettings.ownerId, ownerId), isNull(kitchenSettings.deletedAt)))
    .orderBy(asc(kitchenSettings.id))
    .limit(1);
  const dishRows = await tx
    .select({ dishId: dishes.id, recipeId: dishes.recipeId, scaleFactor: dishes.scaleFactor })
    .from(dishes)
    .innerJoin(courses, eq(courses.id, dishes.courseId))
    .innerJoin(recipes, eq(recipes.id, dishes.recipeId))
    .where(
      and(
        eq(courses.menuId, menuId),
        eq(dishes.ownerId, ownerId),
        isNull(dishes.deletedAt),
        isNull(courses.deletedAt),
        eq(recipes.ownerId, ownerId),
        isNull(recipes.deletedAt),
      ),
    )
    .orderBy(
      asc(sql`${courses.position} collate "C"`),
      asc(sql`${dishes.position} collate "C"`),
      asc(dishes.id),
    );

  const snapshots = new Map<string, RecipeSnapshot>();
  for (const { recipeId } of dishRows)
    if (!snapshots.has(recipeId))
      snapshots.set(recipeId, await loadRecipeSnapshot(tx, ownerId, recipeId));

  // Walk down the sub-recipe lines; a line to a missing or soft-deleted Recipe is a Missing sub-recipe.
  const subRecipes = new Map<string, RecipeSnapshot>();
  let frontier = [...snapshots.values()];
  while (frontier.length) {
    const wanted = [
      ...new Set(
        frontier.flatMap((r) =>
          r.steps.flatMap((s) => s.lines.flatMap((l) => (l.subRecipeId ? [l.subRecipeId] : []))),
        ),
      ),
    ].filter((id) => !subRecipes.has(id));
    const live = wanted.length
      ? await tx
          .select({ id: recipes.id })
          .from(recipes)
          .where(
            and(
              inArray(recipes.id, wanted),
              eq(recipes.ownerId, ownerId),
              isNull(recipes.deletedAt),
            ),
          )
      : [];
    frontier = [];
    for (const { id } of live.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const snapshot = snapshots.get(id) ?? (await loadRecipeSnapshot(tx, ownerId, id));
      subRecipes.set(id, snapshot);
      frontier.push(snapshot);
    }
  }

  return {
    guestCount: menu?.guestCount ?? null,
    region: settings?.unitRegion === "us" ? "us" : "metric",
    dishes: dishRows.map((d) => ({
      dishId: d.dishId,
      recipeId: d.recipeId,
      scaleFactor: d.scaleFactor === null ? null : Number(d.scaleFactor),
      recipe: snapshots.get(d.recipeId)!,
    })),
    subRecipes,
  };
}

/** The Service's live Batch rows. */
export async function loadBatchRows(
  tx: Tx,
  serviceId: string,
): Promise<{ batchId: string; subRecipeId: string }[]> {
  const rows = await tx
    .select({ batchId: batches.id, subRecipeId: batches.subRecipeId })
    .from(batches)
    .where(and(eq(batches.serviceId, serviceId), isNull(batches.deletedAt)))
    .orderBy(asc(batches.id));
  return rows;
}

/**
 * Makes the Service's Batch rows match the sub-recipes it needs (D7): a missing row is inserted, a
 * soft-deleted one revived with its id, and a live one no longer needed soft-deleted. Anything
 * else writes nothing. Run inside re-plan, under the Service's row lock.
 */
export async function reconcileBatches(
  tx: Tx,
  ownerId: string,
  serviceId: string,
  needed: string[],
): Promise<{ inserted: number; revived: number; removed: number }> {
  const rows = await tx
    .select({ id: batches.id, subRecipeId: batches.subRecipeId, deletedAt: batches.deletedAt })
    .from(batches)
    .where(eq(batches.serviceId, serviceId));
  const bySubRecipe = new Map(rows.map((r) => [r.subRecipeId, r]));
  const wanted = new Set(needed);
  const insert = [];
  for (const subRecipeId of wanted)
    if (!bySubRecipe.has(subRecipeId))
      insert.push({ id: await batchId(serviceId, subRecipeId), ownerId, serviceId, subRecipeId });
  const revive = rows
    .filter((r) => r.deletedAt !== null && wanted.has(r.subRecipeId))
    .map((r) => r.id);
  const remove = rows
    .filter((r) => r.deletedAt === null && !wanted.has(r.subRecipeId))
    .map((r) => r.id);
  if (insert.length) await tx.insert(batches).values(insert);
  if (revive.length)
    await tx
      .update(batches)
      .set({ deletedAt: null, updatedAt: sql`now()` })
      .where(inArray(batches.id, revive));
  if (remove.length)
    await tx
      .update(batches)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(inArray(batches.id, remove));
  return { inserted: insert.length, revived: revive.length, removed: remove.length };
}

/** `recipeId` and every live Recipe that uses it, directly or through other sub-recipes. */
export async function recipeAndAncestors(
  tx: Tx,
  ownerId: string,
  recipeId: string,
): Promise<string[]> {
  const parentsOf = new Map<string, string[]>();
  for (const [parent, children] of await loadSubRecipeGraph(tx, ownerId))
    for (const child of children) parentsOf.set(child, [...(parentsOf.get(child) ?? []), parent]);
  const seen = new Set([recipeId]);
  const queue = [recipeId];
  for (let id = queue.shift(); id !== undefined; id = queue.shift())
    for (const parent of parentsOf.get(id) ?? [])
      if (!seen.has(parent)) (seen.add(parent), queue.push(parent));
  return [...seen];
}

export type MenuScale = {
  dishes: {
    dishId: string;
    scale: { factor: number; source: DishScale["source"] };
    fixes: { subRecipe: { id: string; name: string } | null; text: string }[];
  }[];
  /** `id`: the Service's live Batch row, or null with no Service or no row yet (D8). */
  batches: BatchRead[];
};

/** Each Dish's Scale factor and fixes, and the Batches the Menu needs. Reads only (D8). */
export async function readMenuScale(tx: Tx, ownerId: string, menuId: string): Promise<MenuScale> {
  const scale = deriveScale(await loadScaleRows(tx, ownerId, menuId));
  const [service] = await tx
    .select({ id: services.id })
    .from(services)
    .where(
      and(eq(services.menuId, menuId), eq(services.ownerId, ownerId), isNull(services.deletedAt)),
    );
  const stored = new Map(
    service ? (await loadBatchRows(tx, service.id)).map((b) => [b.subRecipeId, b.batchId]) : [],
  );
  return {
    dishes: scale.dishes.map((d) => ({
      dishId: d.dishId,
      scale: { factor: d.factor, source: d.source },
      fixes: d.fixes.map((f) => ({
        subRecipe: f.subRecipeId === null ? null : { id: f.subRecipeId, name: f.subRecipeName! },
        text: f.text,
      })),
    })),
    batches: scale.batches.map((b) => toBatchRead(b, stored.get(b.subRecipeId) ?? null)),
  };
}
