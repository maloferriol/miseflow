import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { NotFoundError, type Tx } from "../mutators/define.ts";
import { conversions, ingredientAliases, ingredients, shoppingCategories } from "../schema.ts";
import { loadCatalog } from "./load.ts";
import {
  requireVisibleCategory,
  requireVisibleIngredient,
  requireVisibleIngredients,
  visibleTo,
} from "./visibility.ts";

const ownerId = crypto.randomUUID();
const otherId = crypto.randomUUID();

type Kind = "seed" | "ownerlessOwn" | "own" | "others" | "deleted";
const KINDS: Kind[] = ["seed", "ownerlessOwn", "own", "others", "deleted"];

const rowOwner = (kind: Kind) =>
  kind === "seed" || kind === "ownerlessOwn" ? null : kind === "others" ? otherId : ownerId;
const rowSource = (kind: Kind) => (kind === "seed" ? ("seed" as const) : ("own" as const));
const rowDeleted = (kind: Kind) => (kind === "deleted" ? new Date() : null);

// One row of each kind in every catalog table. A deleted row is the caller's own, soft-deleted.
// Each Ingredient has one alias and one Conversion of the same kind.
async function fixture(tx: Tx) {
  const tag = crypto.randomUUID().slice(0, 8);
  const ids = {} as Record<
    Kind,
    { category: string; ingredient: string; alias: string; conversion: string }
  >;
  for (const kind of KINDS) {
    const row = {
      category: crypto.randomUUID(),
      ingredient: crypto.randomUUID(),
      alias: crypto.randomUUID(),
      conversion: crypto.randomUUID(),
    };
    ids[kind] = row;
    const common = { ownerId: rowOwner(kind), deletedAt: rowDeleted(kind) };
    // Shopping categories have no `source`: an ownerless one stands in for both ownerless kinds.
    await tx.insert(shoppingCategories).values({
      id: row.category,
      ...common,
      name: `aisle ${kind} ${tag}`,
      position: "a0",
    });
    await tx.insert(ingredients).values({
      id: row.ingredient,
      ...common,
      name: `${kind} thing ${tag}`,
      source: rowSource(kind),
      preferredKind: "mass",
    });
    await tx.insert(ingredientAliases).values({
      id: row.alias,
      ...common,
      ingredientId: row.ingredient,
      name: `${kind} alias ${tag}`,
      source: rowSource(kind),
    });
    await tx.insert(conversions).values({
      id: row.conversion,
      ...common,
      ingredientId: row.ingredient,
      fromUnit: "cup",
      toUnit: "g",
      factor: "120",
      source: rowSource(kind),
    });
  }
  return ids;
}

const kindsOf = (ids: Record<Kind, Record<string, string>>, field: string, found: string[]) =>
  KINDS.filter((k) => found.includes(ids[k][field]));

describe("visibleTo", () => {
  it("shows seed rows and the caller's own live rows, for every table with a source", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      const ingredientRows = await tx
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(visibleTo(ingredients, ownerId));
      const aliasRows = await tx
        .select({ id: ingredientAliases.id })
        .from(ingredientAliases)
        .where(visibleTo(ingredientAliases, ownerId));
      const conversionRows = await tx
        .select({ id: conversions.id })
        .from(conversions)
        .where(visibleTo(conversions, ownerId));
      expect(
        kindsOf(
          ids,
          "ingredient",
          ingredientRows.map((r) => r.id),
        ),
      ).toEqual(["seed", "own"]);
      expect(
        kindsOf(
          ids,
          "alias",
          aliasRows.map((r) => r.id),
        ),
      ).toEqual(["seed", "own"]);
      expect(
        kindsOf(
          ids,
          "conversion",
          conversionRows.map((r) => r.id),
        ),
      ).toEqual(["seed", "own"]);
    });
  });

  it("shows every ownerless Shopping category and the caller's own live ones", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      const rows = await tx
        .select({ id: shoppingCategories.id })
        .from(shoppingCategories)
        .where(visibleTo(shoppingCategories, ownerId));
      expect(
        kindsOf(
          ids,
          "category",
          rows.map((r) => r.id),
        ),
      ).toEqual(["seed", "ownerlessOwn", "own"]);
    });
  });
});

describe("require helpers", () => {
  it("requireVisibleIngredient returns a seed or own Ingredient and refuses the rest", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      const visible: Kind[] = [];
      for (const kind of KINDS) {
        try {
          const row = await requireVisibleIngredient(tx, ids[kind].ingredient, ownerId);
          expect(row).toEqual({
            id: ids[kind].ingredient,
            source: rowSource(kind),
            preferredKind: "mass",
          });
          visible.push(kind);
        } catch (error) {
          expect(error).toEqual(new NotFoundError("Ingredient"));
        }
      }
      expect(visible).toEqual(["seed", "own"]);
    });
  });

  it("requireVisibleIngredients passes only when every Ingredient is visible", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      await requireVisibleIngredients(tx, ownerId, [
        ids.seed.ingredient,
        ids.own.ingredient,
        ids.seed.ingredient,
      ]);
      await requireVisibleIngredients(tx, ownerId, []);
      for (const kind of ["ownerlessOwn", "others", "deleted"] as const)
        await expect(
          requireVisibleIngredients(tx, ownerId, [ids.seed.ingredient, ids[kind].ingredient]),
        ).rejects.toEqual(new NotFoundError("Ingredient"));
    });
  });

  it("requireVisibleCategory passes for ownerless and own live categories", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      for (const kind of ["seed", "ownerlessOwn", "own"] as const)
        await requireVisibleCategory(tx, ids[kind].category, ownerId);
      for (const kind of ["others", "deleted"] as const)
        await expect(requireVisibleCategory(tx, ids[kind].category, ownerId)).rejects.toEqual(
          new NotFoundError("Shopping category"),
        );
    });
  });
});

describe("loadCatalog", () => {
  it("leaves out an ownerless Ingredient or alias whose source is own", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      const mine = Object.values(ids).map((r) => r.ingredient);
      const catalog = (await loadCatalog(tx, ownerId)).filter((e) => mine.includes(e.id));
      expect(
        kindsOf(
          ids,
          "ingredient",
          catalog.map((e) => e.id),
        ),
      ).toEqual(["seed", "own"]);
      expect(catalog.flatMap((e) => e.aliases.map((a) => a.source))).toEqual(["seed", "own"]);

      // An ownerless `own` alias on a seed Ingredient doesn't show either.
      await tx
        .update(ingredientAliases)
        .set({ ingredientId: ids.seed.ingredient })
        .where(inArray(ingredientAliases.id, [ids.ownerlessOwn.alias]));
      const seed = (await loadCatalog(tx, ownerId)).find((e) => e.id === ids.seed.ingredient)!;
      expect(seed.aliases.map((a) => a.source)).toEqual(["seed"]);
    });
  });
});
