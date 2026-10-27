import { shoppingCategories } from "@miseflow/shared";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthEnv } from "../auth.ts";
import type { Db } from "../db.ts";

// GET /shopping-categories: the seed categories plus the caller's own, in shop order.
export function shoppingCategoriesRoute(db: Db) {
  return new Hono<AuthEnv>().get("/", async (c) => {
    const rows = await db
      .select({
        id: shoppingCategories.id,
        name: shoppingCategories.name,
        position: shoppingCategories.position,
      })
      .from(shoppingCategories)
      .where(
        and(
          or(isNull(shoppingCategories.ownerId), eq(shoppingCategories.ownerId, c.get("ownerId"))),
          isNull(shoppingCategories.deletedAt),
        ),
      )
      .orderBy(asc(sql`${shoppingCategories.position} collate "C"`));
    return c.json({ shoppingCategories: rows }, 200);
  });
}
