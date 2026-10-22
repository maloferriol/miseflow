import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { courses, dishes, menus, recipes } from "../schema.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

const ownerId = crypto.randomUUID();

describe("mutator registry", () => {
  it("finds a mutator by name", () => {
    expect(getMutator("createMenu")?.name).toBe("createMenu");
  });

  it("returns undefined for an unknown name, including Object.prototype keys", () => {
    expect(getMutator("nope")).toBeUndefined();
    expect(getMutator("toString")).toBeUndefined();
    expect(getMutator("__proto__")).toBeUndefined();
  });
});

describe("createMenu args", () => {
  const args = getMutator("createMenu")!.args;
  const valid = { menuId: crypto.randomUUID(), name: "Saturday dinner", guestCount: 6 };

  it("accepts a Menu with a name and guest count", () => {
    expect(args.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(args.safeParse({ ...valid, name: undefined }).success).toBe(false);
  });

  it("rejects a guest count that is not a whole number of at least 1", () => {
    expect(args.safeParse({ ...valid, guestCount: 2.5 }).success).toBe(false);
    expect(args.safeParse({ ...valid, guestCount: 0 }).success).toBe(false);
  });

  it("rejects a menuId that is not a uuid", () => {
    expect(args.safeParse({ ...valid, menuId: "menu-1" }).success).toBe(false);
  });
});

describe("createMenu", () => {
  it("inserts the Menu stamped with the owner", async () => {
    const menuId = crypto.randomUUID();
    await inRollback(async (tx) => {
      const mutator = getMutator("createMenu")!;
      await mutator.run(tx, mutator.args.parse({ menuId, name: "Saturday dinner", guestCount: 6 }), {
        ownerId,
      });
      const rows = await tx.select().from(menus).where(eq(menus.id, menuId));
      expect(rows).toMatchObject([{ name: "Saturday dinner", guestCount: 6, ownerId }]);
    });
  });
});

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner });
}

describe("addCourse", () => {
  it("appends each Course after the last one in the Menu", async () => {
    const menuId = crypto.randomUUID();
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
    await inRollback(async (tx) => {
      await run(tx, "createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
      await run(tx, "addCourse", { courseId: first, menuId, name: "Starter" });
      await run(tx, "addCourse", { courseId: second, menuId, name: "Main" });

      const rows = await tx.select().from(courses).where(eq(courses.menuId, menuId));
      const position = (id: string) => rows.find((r) => r.id === id)!.position;
      expect(position(first) < position(second)).toBe(true);
      expect(rows.every((r) => r.ownerId === ownerId)).toBe(true);
    });
  });

  it("refuses another owner's Menu", async () => {
    const menuId = crypto.randomUUID();
    await inRollback(async (tx) => {
      await run(tx, "createMenu", { menuId, name: "Theirs", guestCount: 2 }, crypto.randomUUID());
      await expect(
        run(tx, "addCourse", { courseId: crypto.randomUUID(), menuId, name: "Starter" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("addDish", () => {
  it("places the Recipe in the Course", async () => {
    const [menuId, courseId, recipeId, dishId] = Array.from({ length: 4 }, () => crypto.randomUUID());
    await inRollback(async (tx) => {
      await run(tx, "createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
      await run(tx, "addCourse", { courseId, menuId, name: "Starter" });
      await run(tx, "createRecipe", { recipeId, revisionId: crypto.randomUUID(), name: "Velouté" });
      await run(tx, "addDish", { dishId, courseId, recipeId });

      const rows = await tx.select().from(dishes).where(eq(dishes.id, dishId));
      expect(rows).toMatchObject([{ courseId, recipeId, ownerId }]);
    });
  });

  it("refuses another owner's Recipe", async () => {
    const [menuId, courseId, recipeId] = Array.from({ length: 3 }, () => crypto.randomUUID());
    await inRollback(async (tx) => {
      await run(tx, "createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
      await run(tx, "addCourse", { courseId, menuId, name: "Starter" });
      await tx.insert(recipes).values({ id: recipeId, ownerId: crypto.randomUUID(), name: "Theirs" });
      await expect(
        run(tx, "addDish", { dishId: crypto.randomUUID(), courseId, recipeId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
