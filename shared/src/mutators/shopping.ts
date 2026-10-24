import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { findLiveService } from "../plan/replan.ts";
import { shoppingMarks } from "../schema.ts";
import { defineMutator } from "./define.ts";
import { requireVisibleIngredient } from "./ingredients.ts";

// Got ticks on a Service's Shopping list (ADR 0004: a single Got tick). A mark is one
// `shopping_marks` row per Service and Ingredient; neither mutation changes a Task, so neither
// re-plans. The Service is read without a row lock: the insert's KEY SHARE on it is enough.

/**
 * Ticks an Ingredient Got. Any Ingredient the kitchen can see, on the list or not (#91 owner
 * decision 7). The row is unique per Service and Ingredient, deleted rows included, so ticking
 * again revives the first row with its id and `markId` is used only by the first insert.
 */
export const markGot = defineMutator({
  name: "markGot",
  args: z.strictObject({ markId: z.uuid(), serviceId: z.uuid(), ingredientId: z.uuid() }),
  async run(tx, args, { ownerId }) {
    await findLiveService(tx, ownerId, args.serviceId);
    await requireVisibleIngredient(tx, args.ingredientId, ownerId);
    await tx
      .insert(shoppingMarks)
      .values({ id: args.markId, ownerId, serviceId: args.serviceId, ingredientId: args.ingredientId, status: "got" })
      .onConflictDoUpdate({
        target: [shoppingMarks.serviceId, shoppingMarks.ingredientId],
        set: { status: "got", deletedAt: null, updatedAt: sql`now()` },
      });
  },
});

/** Un-ticks an Ingredient: soft-deletes its live mark, if any. */
export const unmarkGot = defineMutator({
  name: "unmarkGot",
  args: z.strictObject({ serviceId: z.uuid(), ingredientId: z.uuid() }),
  async run(tx, args, { ownerId }) {
    await findLiveService(tx, ownerId, args.serviceId);
    await tx
      .update(shoppingMarks)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(shoppingMarks.serviceId, args.serviceId),
          eq(shoppingMarks.ingredientId, args.ingredientId),
          eq(shoppingMarks.ownerId, ownerId),
          isNull(shoppingMarks.deletedAt),
        ),
      );
  },
});
