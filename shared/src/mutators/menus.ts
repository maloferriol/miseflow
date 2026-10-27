import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { replanAffected } from "../plan/replan.ts";
import { courses, dishes, menus, recipes } from "../schema.ts";
import { defineMutator, InvalidArgsError, NotFoundError, type Tx } from "./define.ts";
import { positionAfter } from "./position.ts";

const name = z.string().trim().min(1).max(200);

export const createMenu = defineMutator({
  name: "createMenu",
  args: z.strictObject({
    menuId: z.uuid(),
    name,
    guestCount: z.int().min(1).max(10_000),
  }),
  async run(tx, args, { ownerId }) {
    await tx.insert(menus).values({
      id: args.menuId,
      ownerId,
      name: args.name,
      guestCount: args.guestCount,
    });
  },
});

export const addCourse = defineMutator({
  name: "addCourse",
  args: z.strictObject({ courseId: z.uuid(), menuId: z.uuid(), name }),
  async run(tx, args, { ownerId }) {
    await requireOwned(tx, menus, args.menuId, ownerId, "Menu", { lock: true });
    // Soft-deleted siblings count too, so a new key never repeats one of theirs.
    const [last] = await tx
      .select({ position: courses.position })
      .from(courses)
      .where(eq(courses.menuId, args.menuId))
      .orderBy(desc(sql`${courses.position} collate "C"`))
      .limit(1);
    await tx.insert(courses).values({
      id: args.courseId,
      ownerId,
      menuId: args.menuId,
      name: args.name,
      position: positionAfter(last?.position ?? null),
    });
  },
});

export const addDish = defineMutator({
  name: "addDish",
  args: z.strictObject({ dishId: z.uuid(), courseId: z.uuid(), recipeId: z.uuid() }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    await requireOwned(tx, courses, args.courseId, ownerId, "Course", { lock: true });
    await requireOwned(tx, recipes, args.recipeId, ownerId, "Recipe");
    const [last] = await tx
      .select({ position: dishes.position })
      .from(dishes)
      .where(eq(dishes.courseId, args.courseId))
      .orderBy(desc(sql`${dishes.position} collate "C"`))
      .limit(1);
    await tx.insert(dishes).values({
      id: args.dishId,
      ownerId,
      courseId: args.courseId,
      recipeId: args.recipeId,
      position: positionAfter(last?.position ?? null),
    });
    const [course] = await tx.select({ menuId: courses.menuId }).from(courses).where(eq(courses.id, args.courseId));
    await replanAffected(tx, ctx, { menuId: course!.menuId });
  },
});

/**
 * A Dish's Scale factor (units spec §5): back to the guest count, a factor, or a portion count,
 * stored as portions over the Recipe's servings (D5). No re-plan: durations don't scale (spec §4)
 * and every Batch size is derived on read (D6).
 */
export const setDishScale = defineMutator({
  name: "setDishScale",
  args: z.strictObject({
    dishId: z.uuid(),
    scale: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("guests") }),
      z.strictObject({ kind: z.literal("factor"), factor: z.number().positive().max(1000) }),
      z.strictObject({ kind: z.literal("portions"), portions: z.int().min(1).max(10_000) }),
    ]),
  }),
  async run(tx, args, { ownerId }) {
    const [dish] = await tx
      .select({ id: dishes.id, servings: recipes.servings })
      .from(dishes)
      .innerJoin(recipes, eq(recipes.id, dishes.recipeId))
      .where(and(eq(dishes.id, args.dishId), eq(dishes.ownerId, ownerId), isNull(dishes.deletedAt)))
      .for("no key update", { of: dishes });
    if (!dish) throw new NotFoundError("Dish");
    let factor: number | null = null;
    if (args.scale.kind === "factor") factor = args.scale.factor;
    if (args.scale.kind === "portions") {
      const servings = dish.servings === null ? 0 : Number(dish.servings);
      if (!(servings > 0)) throw new InvalidArgsError("This Recipe has no servings; set a factor instead");
      factor = args.scale.portions / servings;
    }
    await tx
      .update(dishes)
      .set({ scaleFactor: factor === null ? null : String(factor), updatedAt: sql`now()` })
      .where(eq(dishes.id, args.dishId));
  },
});

/**
 * The "remove the Dish" quick fix (#90 AC3, spec §6.5): soft-deletes a Dish, then re-plans its
 * Menu's Services. The re-plan does the rest: Batches nothing else uses drop out
 * (`reconcileBatches`), and the diff removes the Dish's placements.
 */
export const removeDish = defineMutator({
  name: "removeDish",
  args: z.strictObject({ dishId: z.uuid() }),
  async run(tx, args, ctx) {
    // The Dish first, then the Services inside the re-plan, as addDish (child row, then Services).
    // FOR NO KEY UPDATE: Step events and placements take FOR KEY SHARE on the Dish when inserted,
    // so a tickStep holding the Service doesn't wait on it (#84, #87).
    const [dish] = await tx
      .select({ id: dishes.id, menuId: courses.menuId })
      .from(dishes)
      .innerJoin(courses, eq(courses.id, dishes.courseId))
      .where(and(eq(dishes.id, args.dishId), eq(dishes.ownerId, ctx.ownerId), isNull(dishes.deletedAt)))
      .for("no key update", { of: dishes });
    if (!dish) throw new NotFoundError("Dish");
    await tx.update(dishes).set({ deletedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(dishes.id, dish.id));
    await replanAffected(tx, ctx, { menuId: dish.menuId });
  },
});

// A parent row must exist, be live and belong to the caller; anything else reads as missing.
// `lock` takes a row lock on the parent until the transaction ends, so concurrent appends to the
// same parent read the last sibling one after another and never get the same position.
async function requireOwned(
  tx: Tx,
  table: typeof menus | typeof courses | typeof recipes,
  id: string,
  ownerId: string,
  what: string,
  { lock = false } = {},
) {
  const query = tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.ownerId, ownerId), isNull(table.deletedAt)));
  // FOR NO KEY UPDATE, as lockRecipe: appends still serialise, and FK checks (FOR KEY SHARE) don't wait.
  const [row] = lock ? await query.for("no key update") : await query;
  if (!row) throw new NotFoundError(what);
}
