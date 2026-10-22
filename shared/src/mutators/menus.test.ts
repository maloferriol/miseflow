import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { menus } from "../schema.ts";
import { getMutator } from "./registry.ts";

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
