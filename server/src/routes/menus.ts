import { courses, dishes, menus, recipes } from "@miseflow/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../auth.ts";
import type { Db } from "../db.ts";
import { errorBody } from "../errors.ts";

const menuIdParam = z.uuid();

// GET /menus: the caller's live Menus, most recently changed first.
// GET /menus/:menuId: one Menu with its Courses and Dishes, only the caller's live rows.
// Chained, so the web app's hc<AppType> client gets the response type (Hono RPC).
// Source: https://hono.dev/docs/guides/rpc
export function menusRoute(db: Db) {
  return new Hono<AuthEnv>()
    .get("/", async (c) => {
      const rows = await db
        .select({ id: menus.id, name: menus.name, guestCount: menus.guestCount })
        .from(menus)
        .where(and(eq(menus.ownerId, c.get("ownerId")), isNull(menus.deletedAt)))
        .orderBy(desc(menus.updatedAt), asc(menus.id));
      return c.json({ menus: rows }, 200);
    })
    .get("/:menuId", async (c) => {
      const ownerId = c.get("ownerId");
      const menuId = menuIdParam.safeParse(c.req.param("menuId"));
      const [menu] = menuId.success
        ? await db
            .select({ id: menus.id, name: menus.name, guestCount: menus.guestCount })
            .from(menus)
            .where(and(eq(menus.id, menuId.data), eq(menus.ownerId, ownerId), isNull(menus.deletedAt)))
        : [];
      if (!menu) return c.json(errorBody("NOT_FOUND", "Menu not found"), 404);

      const courseRows = await db
        .select({ id: courses.id, name: courses.name, position: courses.position })
        .from(courses)
        .where(and(eq(courses.menuId, menu.id), eq(courses.ownerId, ownerId), isNull(courses.deletedAt)))
        .orderBy(asc(sql`${courses.position} collate "C"`));

      const dishRows = courseRows.length
        ? await db
            .select({
              id: dishes.id,
              courseId: dishes.courseId,
              position: dishes.position,
              recipe: { id: recipes.id, name: recipes.name },
            })
            .from(dishes)
            .innerJoin(recipes, eq(recipes.id, dishes.recipeId))
            .where(
              and(
                inArray(
                  dishes.courseId,
                  courseRows.map((course) => course.id),
                ),
                eq(dishes.ownerId, ownerId),
                isNull(dishes.deletedAt),
                eq(recipes.ownerId, ownerId),
                isNull(recipes.deletedAt),
              ),
            )
            .orderBy(asc(sql`${dishes.position} collate "C"`))
        : [];

      return c.json(
        {
          menu: {
            ...menu,
            courses: courseRows.map((course) => ({
              ...course,
              dishes: dishRows
                .filter((dish) => dish.courseId === course.id)
                .map(({ id, position, recipe }) => ({ id, position, recipe })),
            })),
          },
        },
        200,
      );
    });
}
