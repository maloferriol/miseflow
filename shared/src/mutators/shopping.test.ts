import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME } from "../../test/walkthrough.ts";
import {
  conversions,
  ingredients,
  recipes,
  services,
  shoppingCategories,
  shoppingMarks,
} from "../schema.ts";
import { readShoppingList } from "../shopping/read.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

const ownerId = crypto.randomUUID();

const FIXED_NOW = new Date("2026-10-26T12:00:00Z");

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), {
    ownerId: owner,
    timeZone: "Europe/Paris",
    now: () => FIXED_NOW,
  });
}

// Seed-like Shopping categories and Ingredients of the test's own, so `shared` doesn't depend on
// the server's seed file. Names are unique per run, so they never match the real seed.
async function seedFixture(tx: Tx) {
  const tag = crypto.randomUUID().slice(0, 8);
  const category = async (name: string, position: string) => {
    const id = crypto.randomUUID();
    await tx
      .insert(shoppingCategories)
      .values({ id, ownerId: null, name: `${name} ${tag}`, position });
    return id;
  };
  const produce = await category("Produce", "a0");
  const dairy = await category("Dairy & eggs", "a2");
  const dry = await category("Dry goods", "a4");
  const spices = await category("Spices", "a5");
  const ingredient = async (name: string, preferredKind: string, shoppingCategoryId: string) => {
    const id = crypto.randomUUID();
    await tx.insert(ingredients).values({
      id,
      ownerId: null,
      name: `${name} ${tag}`,
      source: "seed",
      preferredKind,
      shoppingCategoryId,
    });
    return id;
  };
  const ids = {
    shallot: await ingredient("shallot", "mass", produce),
    butter: await ingredient("butter", "mass", dairy),
    flour: await ingredient("all-purpose flour", "mass", dry),
    salt: await ingredient("salt", "mass", spices),
    apple: await ingredient("apple", "count", produce),
    sugar: await ingredient("sugar", "mass", dry),
  };
  const leek = await ingredient("leek", "mass", produce);
  return { tag, ids, leek };
}

// The walkthrough with its Ingredient lines and Pastry, and its Service, in the test's transaction.
async function shoppingWalkthrough(tx: Tx) {
  const fixture = await seedFixture(tx);
  const w = await buildWalkthrough((name, args) => run(tx, name, args), fixture.tag, {
    shopping: fixture.ids,
  });
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
  return { ...fixture, w, serviceId };
}

// A bare Service with no Dishes.
async function emptyService(tx: Tx, owner = ownerId) {
  const menuId = crypto.randomUUID();
  const serviceId = crypto.randomUUID();
  await run(tx, "createMenu", { menuId, name: "Lunch", guestCount: 2 }, owner);
  await run(
    tx,
    "createService",
    { serviceId, menuId, date: SERVICE_DATE, time: SERVICE_TIME },
    owner,
  );
  return serviceId;
}

const marks = (tx: Tx, serviceId: string) =>
  tx
    .select({
      id: shoppingMarks.id,
      ingredientId: shoppingMarks.ingredientId,
      status: shoppingMarks.status,
      deletedAt: shoppingMarks.deletedAt,
      ownerId: shoppingMarks.ownerId,
    })
    .from(shoppingMarks)
    .where(eq(shoppingMarks.serviceId, serviceId));

describe("markGot and unmarkGot", () => {
  it("markGot writes one shopping_marks row with status got", async () => {
    await inRollback(async (tx) => {
      const { ids, serviceId } = await shoppingWalkthrough(tx);
      const markId = crypto.randomUUID();
      await run(tx, "markGot", { markId, serviceId, ingredientId: ids.butter });
      expect(await marks(tx, serviceId)).toEqual([
        { id: markId, ingredientId: ids.butter, status: "got", deletedAt: null, ownerId },
      ]);
    });
  });

  it("unmarkGot un-ticks the row", async () => {
    await inRollback(async (tx) => {
      const { ids, serviceId } = await shoppingWalkthrough(tx);
      await run(tx, "markGot", {
        markId: crypto.randomUUID(),
        serviceId,
        ingredientId: ids.butter,
      });
      await run(tx, "unmarkGot", { serviceId, ingredientId: ids.butter });
      const [row] = await marks(tx, serviceId);
      expect(row.deletedAt).not.toBeNull();
      const list = await readShoppingList(tx, ownerId, serviceId);
      expect(
        list.categories.flatMap((c) => c.rows).find((r) => r.ingredientId === ids.butter)!.got,
      ).toBe(false);
    });
  });

  it("markGot after unmarkGot brings the same row back", async () => {
    await inRollback(async (tx) => {
      const { ids, serviceId } = await shoppingWalkthrough(tx);
      const first = crypto.randomUUID();
      await run(tx, "markGot", { markId: first, serviceId, ingredientId: ids.butter });
      await run(tx, "unmarkGot", { serviceId, ingredientId: ids.butter });
      await run(tx, "markGot", {
        markId: crypto.randomUUID(),
        serviceId,
        ingredientId: ids.butter,
      });
      expect(await marks(tx, serviceId)).toEqual([
        { id: first, ingredientId: ids.butter, status: "got", deletedAt: null, ownerId },
      ]);
    });
  });

  it("markGot twice leaves one row", async () => {
    await inRollback(async (tx) => {
      const { ids, serviceId } = await shoppingWalkthrough(tx);
      await run(tx, "markGot", {
        markId: crypto.randomUUID(),
        serviceId,
        ingredientId: ids.butter,
      });
      await run(tx, "markGot", {
        markId: crypto.randomUUID(),
        serviceId,
        ingredientId: ids.butter,
      });
      expect(await marks(tx, serviceId)).toHaveLength(1);
    });
  });

  it("markGot is allowed for an Ingredient not on the list", async () => {
    await inRollback(async (tx) => {
      const { leek } = await seedFixture(tx);
      const serviceId = await emptyService(tx);
      await run(tx, "markGot", { markId: crypto.randomUUID(), serviceId, ingredientId: leek });
      expect(await marks(tx, serviceId)).toEqual([
        expect.objectContaining({ ingredientId: leek, status: "got", deletedAt: null }),
      ]);
      expect((await readShoppingList(tx, ownerId, serviceId)).categories).toEqual([]);
    });
  });

  it("refuses another owner's Service", async () => {
    await inRollback(async (tx) => {
      const { leek } = await seedFixture(tx);
      const theirs = await emptyService(tx, crypto.randomUUID());
      await expect(
        run(tx, "markGot", { markId: crypto.randomUUID(), serviceId: theirs, ingredientId: leek }),
      ).rejects.toThrow(NotFoundError);
      await expect(run(tx, "unmarkGot", { serviceId: theirs, ingredientId: leek })).rejects.toThrow(
        NotFoundError,
      );
      await expect(readShoppingList(tx, ownerId, theirs)).rejects.toThrow(NotFoundError);
      // A soft-deleted Service of the caller's is missing too.
      const gone = await emptyService(tx);
      await tx.update(services).set({ deletedAt: new Date() }).where(eq(services.id, gone));
      await expect(
        run(tx, "markGot", { markId: crypto.randomUUID(), serviceId: gone, ingredientId: leek }),
      ).rejects.toThrow(NotFoundError);
      expect(await marks(tx, theirs)).toEqual([]);
    });
  });

  it("refuses an Ingredient the kitchen can't see", async () => {
    await inRollback(async (tx) => {
      const { leek } = await seedFixture(tx);
      const serviceId = await emptyService(tx);
      const theirs = crypto.randomUUID();
      await tx.insert(ingredients).values({
        id: theirs,
        ownerId: crypto.randomUUID(),
        name: "their own thing",
        source: "own",
        preferredKind: "mass",
      });
      await expect(
        run(tx, "markGot", { markId: crypto.randomUUID(), serviceId, ingredientId: theirs }),
      ).rejects.toThrow(NotFoundError);
      await tx.update(ingredients).set({ deletedAt: new Date() }).where(eq(ingredients.id, leek));
      await expect(
        run(tx, "markGot", { markId: crypto.randomUUID(), serviceId, ingredientId: leek }),
      ).rejects.toThrow(NotFoundError);
      expect(await marks(tx, serviceId)).toEqual([]);
    });
  });
});

describe("readShoppingList", () => {
  it("lists the walkthrough's rows by Shopping category, and shows Got after markGot", async () => {
    await inRollback(async (tx) => {
      const { tag, ids, serviceId } = await shoppingWalkthrough(tx);
      await run(tx, "markGot", {
        markId: crypto.randomUUID(),
        serviceId,
        ingredientId: ids.butter,
      });
      const list = await readShoppingList(tx, ownerId, serviceId);
      // A fresh read, as after a reload, keeps the tick.
      expect(
        list.categories.map((c) => [
          c.name,
          c.rows.map((r) => [r.name, r.need, r.unit, r.approximate, r.vague, r.got]),
        ]),
      ).toEqual([
        [
          `Produce ${tag}`,
          [
            [`apple ${tag}`, 6, "each", false, [], false],
            [`shallot ${tag}`, 150, "g", false, [], false],
          ],
        ],
        [`Dairy & eggs ${tag}`, [[`butter ${tag}`, 300, "g", false, [], true]]],
        [
          `Dry goods ${tag}`,
          [
            [`all-purpose flour ${tag}`, 200, "g", false, [], false],
            [`sugar ${tag}`, 150, "g", false, [], false],
          ],
        ],
        [`Spices ${tag}`, [[`salt ${tag}`, null, "g", false, ["a pinch"], false]]],
      ]);
      expect(list.missing).toEqual([]);
    });
  });

  it("flags a line whose sub-recipe was deleted as a Missing sub-recipe", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await shoppingWalkthrough(tx);
      // Stands in for a Recipe deletion: the Pastry line in the Tarte tatin is now Missing.
      await tx
        .update(recipes)
        .set({ deletedAt: new Date() })
        .where(and(eq(recipes.id, w.recipes.pastry!), eq(recipes.ownerId, ownerId)));
      const list = await readShoppingList(tx, ownerId, serviceId);
      expect(list.missing).toEqual([expect.objectContaining({ recipeName: w.names.tarte })]);
      // The Pastry's flour came only through its Batch.
      expect(
        list.categories.flatMap((c) => c.rows).some((r) => r.name.startsWith("all-purpose flour")),
      ).toBe(false);
    });
  });
  it("uses a seed Conversion but not an ownerless one whose source is own", async () => {
    await inRollback(async (tx) => {
      const { ids, serviceId } = await shoppingWalkthrough(tx);
      await tx.update(ingredients).set({ mainUnit: "g" }).where(eq(ingredients.id, ids.apple));
      const conversion = (source: "seed" | "own") => ({
        id: crypto.randomUUID(),
        ownerId: null,
        ingredientId: ids.apple,
        fromUnit: "each",
        toUnit: "g",
        factor: "150",
        source,
      });
      const apple = async () =>
        (await readShoppingList(tx, ownerId, serviceId)).categories
          .flatMap((c) => c.rows)
          .find((r) => r.ingredientId === ids.apple);
      await tx.insert(conversions).values(conversion("own"));
      expect(await apple()).toMatchObject({
        need: null,
        unit: "g",
        unconverted: [{ amount: 6, unit: null }],
      });
      await tx.insert(conversions).values(conversion("seed"));
      expect(await apple()).toMatchObject({
        need: 900,
        unit: "g",
        approximate: true,
        unconverted: [],
      });
    });
  });
});
