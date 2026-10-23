import { courses, dishes, menus } from "@miseflow/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, getToken, testApp } from "./helpers.ts";

async function send(method: "GET" | "POST", path: string, body?: unknown) {
  return testApp().request(path, {
    method,
    headers: { Authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function mutate(name: string, args: Record<string, unknown>) {
  const res = await send("POST", "/mutate", { id: crypto.randomUUID(), name, args });
  expect(res.status).toBe(200);
}

describe("GET /menus/:menuId", () => {
  it("returns the Menu with its Courses, Dishes and Recipe names", async () => {
    const [menuId, courseId, recipeId, dishId] = Array.from({ length: 4 }, () => crypto.randomUUID());
    await mutate("createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
    await mutate("addCourse", { courseId, menuId, name: "Starter" });
    await mutate("createRecipe", { recipeId, revisionId: crypto.randomUUID(), name: "Velouté" });
    await mutate("addDish", { dishId, courseId, recipeId });

    const res = await send("GET", `/menus/${menuId}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      menu: {
        id: menuId,
        name: "Saturday dinner",
        guestCount: 6,
        courses: [
          {
            id: courseId,
            name: "Starter",
            position: "a0",
            dishes: [{ id: dishId, position: "a0", recipe: { id: recipeId, name: "Velouté" } }],
          },
        ],
      },
    });
  });

  it("answers 404 for another owner's Menu", async () => {
    const menuId = crypto.randomUUID();
    await db.insert(menus).values({ id: menuId, ownerId: crypto.randomUUID(), name: "Theirs" });

    const res = await send("GET", `/menus/${menuId}`);

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("leaves out another owner's Course under the caller's Menu and Dish under the caller's Course", async () => {
    const [menuId, courseId, recipeId] = Array.from({ length: 3 }, () => crypto.randomUUID());
    await mutate("createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
    await mutate("addCourse", { courseId, menuId, name: "Starter" });
    await mutate("createRecipe", { recipeId, revisionId: crypto.randomUUID(), name: "Velouté" });
    const stranger = crypto.randomUUID();
    await db
      .insert(courses)
      .values({ id: crypto.randomUUID(), ownerId: stranger, menuId, name: "Theirs", position: "a1" });
    await db
      .insert(dishes)
      .values({ id: crypto.randomUUID(), ownerId: stranger, courseId, recipeId, position: "a0" });

    const body = await (await send("GET", `/menus/${menuId}`)).json();

    expect(body.menu.courses).toEqual([{ id: courseId, name: "Starter", position: "a0", dishes: [] }]);
  });

  it("answers 404 for an id that is not a uuid", async () => {
    expect((await send("GET", "/menus/not-a-uuid")).status).toBe(404);
  });

  it("leaves soft-deleted Courses out", async () => {
    const [menuId, kept, deleted] = Array.from({ length: 3 }, () => crypto.randomUUID());
    await mutate("createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
    await mutate("addCourse", { courseId: kept, menuId, name: "Starter" });
    await mutate("addCourse", { courseId: deleted, menuId, name: "Main" });
    await db.update(courses).set({ deletedAt: new Date() }).where(eq(courses.id, deleted));

    const body = await (await send("GET", `/menus/${menuId}`)).json();

    expect(body.menu.courses.map((c: { id: string }) => c.id)).toEqual([kept]);
  });
});
