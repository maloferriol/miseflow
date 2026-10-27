import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import {
  ingredientAliases,
  ingredientOverrides,
  ingredients,
  shoppingCategories,
} from "../schema.ts";
import { ConflictError, InvalidArgsError } from "./define.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");

const ownerId = crypto.randomUUID();

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), {
    ownerId: owner,
    timeZone: "Europe/Paris",
    now: () => FIXED_NOW,
  });
}

// A seed Shopping category and Ingredient of the tests' own, so `shared` doesn't depend on the
// server's seed file. Names are unique per run, so they never match the real seed.
async function seedFixture(tx: Tx) {
  const tag = crypto.randomUUID().slice(0, 8);
  const categoryId = crypto.randomUUID();
  const ingredientId = crypto.randomUUID();
  await tx.insert(shoppingCategories).values({
    id: categoryId,
    ownerId: null,
    name: `aisle ${tag}`,
    position: "a0",
  });
  await tx.insert(ingredients).values({
    id: ingredientId,
    ownerId: null,
    name: `${tag} seed thing`,
    source: "seed",
    preferredKind: "mass",
    shoppingCategoryId: categoryId,
  });
  await tx.insert(ingredientAliases).values({
    id: crypto.randomUUID(),
    ownerId: null,
    ingredientId,
    name: `${tag} seed alias`,
    source: "seed",
  });
  return { tag, categoryId, ingredientId };
}

describe("createIngredient", () => {
  it("inserts the kitchen's own Ingredient, stamped with the owner", async () => {
    await inRollback(async (tx) => {
      const { tag, categoryId } = await seedFixture(tx);
      const ingredientId = crypto.randomUUID();

      await run(tx, "createIngredient", {
        ingredientId,
        name: `Espelette ${tag}`,
        preferredKind: "mass",
        shoppingCategoryId: categoryId,
      });

      const rows = await tx.select().from(ingredients).where(eq(ingredients.id, ingredientId));
      expect(rows).toMatchObject([
        {
          ownerId,
          source: "own",
          name: `Espelette ${tag}`,
          preferredKind: "mass",
          shoppingCategoryId: categoryId,
        },
      ]);
    });
  });

  it("refuses another owner's Shopping category", async () => {
    await inRollback(async (tx) => {
      const categoryId = crypto.randomUUID();
      await tx.insert(shoppingCategories).values({
        id: categoryId,
        ownerId: crypto.randomUUID(),
        name: "Theirs",
        position: "a0",
      });

      await expect(
        run(tx, "createIngredient", {
          ingredientId: crypto.randomUUID(),
          name: "Anything",
          preferredKind: "mass",
          shoppingCategoryId: categoryId,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("refuses a name that already matches an Ingredient's name or alias", async () => {
    await inRollback(async (tx) => {
      const { tag, categoryId } = await seedFixture(tx);
      const create = (name: string) =>
        run(tx, "createIngredient", {
          ingredientId: crypto.randomUUID(),
          name,
          preferredKind: "mass",
          shoppingCategoryId: categoryId,
        });

      await expect(create(`${tag} Seed Things`)).rejects.toThrow(ConflictError);
      await expect(create(`${tag} seed alias`)).rejects.toThrow(ConflictError);
    });
  });

  it("rejects a Main unit of another kind of measure", () => {
    const args = getMutator("createIngredient")!.args;
    const valid = {
      ingredientId: crypto.randomUUID(),
      name: "Milk powder",
      preferredKind: "mass",
      shoppingCategoryId: crypto.randomUUID(),
    };
    expect(args.safeParse({ ...valid, mainUnit: "kg" }).success).toBe(true);
    expect(args.safeParse({ ...valid, mainUnit: "ml" }).success).toBe(false);
  });
});

describe("addAlias", () => {
  it("adds the kitchen's own alias to a seed Ingredient", async () => {
    await inRollback(async (tx) => {
      const { ingredientId } = await seedFixture(tx);
      const aliasId = crypto.randomUUID();

      await run(tx, "addAlias", { aliasId, ingredientId, name: "Piment" });

      const rows = await tx
        .select()
        .from(ingredientAliases)
        .where(eq(ingredientAliases.id, aliasId));
      expect(rows).toMatchObject([{ ownerId, ingredientId, name: "Piment", source: "own" }]);
    });
  });

  it("allows a kitchen alias equal to a seed alias", async () => {
    await inRollback(async (tx) => {
      const seed = await seedFixture(tx);
      const other = await seedFixture(tx);

      await run(tx, "addAlias", {
        aliasId: crypto.randomUUID(),
        ingredientId: other.ingredientId,
        name: `${seed.tag} seed alias`,
      });
    });
  });

  it("refuses an alias the kitchen already has on another Ingredient", async () => {
    await inRollback(async (tx) => {
      const first = await seedFixture(tx);
      const second = await seedFixture(tx);
      await run(tx, "addAlias", {
        aliasId: crypto.randomUUID(),
        ingredientId: first.ingredientId,
        name: "the usual",
      });

      await expect(
        run(tx, "addAlias", {
          aliasId: crypto.randomUUID(),
          ingredientId: second.ingredientId,
          name: "The Usual",
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  it("refuses an alias equal to the name of the kitchen's own Ingredient elsewhere", async () => {
    await inRollback(async (tx) => {
      const { tag, categoryId, ingredientId } = await seedFixture(tx);
      await run(tx, "createIngredient", {
        ingredientId: crypto.randomUUID(),
        name: `${tag} Piment`,
        preferredKind: "mass",
        shoppingCategoryId: categoryId,
      });

      await expect(
        run(tx, "addAlias", { aliasId: crypto.randomUUID(), ingredientId, name: `${tag} piment` }),
      ).rejects.toThrow(ConflictError);
    });
  });

  it("refuses another owner's Ingredient", async () => {
    await inRollback(async (tx) => {
      const ingredientId = crypto.randomUUID();
      await tx.insert(ingredients).values({
        id: ingredientId,
        ownerId: crypto.randomUUID(),
        name: "Theirs",
        source: "own",
      });

      await expect(
        run(tx, "addAlias", {
          aliasId: crypto.randomUUID(),
          ingredientId,
          name: "Mine now",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});

describe("overrideIngredient", () => {
  it("writes the override for a seed Ingredient and leaves the seed row untouched", async () => {
    await inRollback(async (tx) => {
      const { ingredientId } = await seedFixture(tx);
      const [before] = await tx.select().from(ingredients).where(eq(ingredients.id, ingredientId));

      await run(tx, "overrideIngredient", {
        overrideId: crypto.randomUUID(),
        ingredientId,
        mainUnit: "kg",
      });
      await run(tx, "overrideIngredient", {
        overrideId: crypto.randomUUID(),
        ingredientId,
        mainUnit: "lb",
      });

      expect(await tx.select().from(ingredients).where(eq(ingredients.id, ingredientId))).toEqual([
        before,
      ]);
      const overrides = await tx
        .select()
        .from(ingredientOverrides)
        .where(eq(ingredientOverrides.ingredientId, ingredientId));
      expect(overrides).toMatchObject([{ ownerId, mainUnit: "lb" }]);
    });
  });

  it("leaves a field it isn't given alone, and clears one given as null", async () => {
    await inRollback(async (tx) => {
      const { ingredientId } = await seedFixture(tx);
      const other = await seedFixture(tx);
      const override = (args: Record<string, unknown>) =>
        run(tx, "overrideIngredient", { overrideId: crypto.randomUUID(), ingredientId, ...args });
      const current = async () =>
        (
          await tx
            .select({
              mainUnit: ingredientOverrides.mainUnit,
              shoppingCategoryId: ingredientOverrides.shoppingCategoryId,
            })
            .from(ingredientOverrides)
            .where(eq(ingredientOverrides.ingredientId, ingredientId))
        )[0];

      await override({ mainUnit: "kg", shoppingCategoryId: other.categoryId });
      await override({ mainUnit: "lb" });
      expect(await current()).toEqual({ mainUnit: "lb", shoppingCategoryId: other.categoryId });

      await override({ mainUnit: null });
      expect(await current()).toEqual({ mainUnit: null, shoppingCategoryId: other.categoryId });

      await override({ shoppingCategoryId: null });
      expect(await current()).toEqual({ mainUnit: null, shoppingCategoryId: null });
    });
  });

  it("updates the kitchen's own Ingredient in place", async () => {
    await inRollback(async (tx) => {
      const { tag, categoryId } = await seedFixture(tx);
      const ingredientId = crypto.randomUUID();
      await run(tx, "createIngredient", {
        ingredientId,
        name: `Own ${tag}`,
        preferredKind: "volume",
        shoppingCategoryId: categoryId,
      });

      await run(tx, "overrideIngredient", {
        overrideId: crypto.randomUUID(),
        ingredientId,
        mainUnit: "L",
      });

      const [row] = await tx.select().from(ingredients).where(eq(ingredients.id, ingredientId));
      expect(row?.mainUnit).toBe("L");
      expect(
        await tx
          .select()
          .from(ingredientOverrides)
          .where(eq(ingredientOverrides.ingredientId, ingredientId)),
      ).toEqual([]);
    });
  });

  it("refuses a Main unit of another kind of measure", async () => {
    await inRollback(async (tx) => {
      const { ingredientId } = await seedFixture(tx);
      await expect(
        run(tx, "overrideIngredient", {
          overrideId: crypto.randomUUID(),
          ingredientId,
          mainUnit: "ml",
        }),
      ).rejects.toThrow(InvalidArgsError);
    });
  });

  it("refuses another owner's Ingredient", async () => {
    await inRollback(async (tx) => {
      const ingredientId = crypto.randomUUID();
      await tx.insert(ingredients).values({
        id: ingredientId,
        ownerId: crypto.randomUUID(),
        name: "Theirs",
        source: "own",
        preferredKind: "mass",
      });

      await expect(
        run(tx, "overrideIngredient", {
          overrideId: crypto.randomUUID(),
          ingredientId,
          mainUnit: "kg",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
