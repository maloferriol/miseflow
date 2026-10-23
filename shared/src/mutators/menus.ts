import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { replanAffected } from "../plan/replan.ts";
import { courses, dishes, menus, recipes } from "../schema.ts";
import { defineMutator, NotFoundError, type Tx } from "./define.ts";
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
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new NotFoundError(what);
}
