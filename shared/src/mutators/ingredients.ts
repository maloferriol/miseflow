import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCatalog } from "../catalog/load.ts";
import { findIngredient, normaliseName } from "../catalog/match.ts";
import { kindSchema, unitFitsKind, unitSchema, type Kind, type Unit } from "../catalog/units.ts";
import {
  ingredientAliases,
  ingredientOverrides,
  ingredients,
  shoppingCategories,
} from "../schema.ts";
import {
  ConflictError,
  defineMutator,
  InvalidArgsError,
  NotFoundError,
  type Tx,
} from "./define.ts";

const name = z.string().trim().min(1).max(200);

export const createIngredient = defineMutator({
  name: "createIngredient",
  args: z
    .strictObject({
      ingredientId: z.uuid(),
      name,
      preferredKind: kindSchema,
      shoppingCategoryId: z.uuid(),
      mainUnit: unitSchema.optional(),
    })
    .refine((args) => !args.mainUnit || unitFitsKind(args.mainUnit, args.preferredKind), {
      message: "The Main unit must be a unit of the preferred kind of measure",
      path: ["mainUnit"],
    }),
  async run(tx, args, { ownerId }) {
    await lockCatalog(tx, ownerId);
    await requireVisibleCategory(tx, args.shoppingCategoryId, ownerId);
    // ADR 0002: a new Ingredient only when nothing in the catalog already has this name.
    const existing = findIngredient(await loadCatalog(tx, ownerId), args.name);
    if (existing)
      throw new ConflictError(`"${args.name}" already matches the Ingredient "${existing.name}"`);
    await tx.insert(ingredients).values({
      id: args.ingredientId,
      ownerId,
      name: args.name,
      source: "own",
      preferredKind: args.preferredKind,
      mainUnit: args.mainUnit ?? null,
      shoppingCategoryId: args.shoppingCategoryId,
    });
  },
});

export const addAlias = defineMutator({
  name: "addAlias",
  args: z.strictObject({ aliasId: z.uuid(), ingredientId: z.uuid(), name }),
  async run(tx, args, { ownerId }) {
    await lockCatalog(tx, ownerId);
    await requireVisibleIngredient(tx, args.ingredientId, ownerId);
    // A kitchen alias that repeats another kitchen alias or the kitchen's own Ingredient name
    // would make "a kitchen alias wins" ambiguous, or hide that Ingredient. A kitchen alias
    // equal to a seed name or alias is fine: that is how the kitchen wins.
    const alias = normaliseName(args.name);
    const clash = (await loadCatalog(tx, ownerId)).find(
      (entry) =>
        entry.id !== args.ingredientId &&
        ((entry.source === "own" && normaliseName(entry.name) === alias) ||
          entry.aliases.some((a) => a.source === "own" && normaliseName(a.name) === alias)),
    );
    if (clash)
      throw new ConflictError(`"${args.name}" is already a name or alias of "${clash.name}"`);
    await tx.insert(ingredientAliases).values({
      id: args.aliasId,
      ownerId,
      ingredientId: args.ingredientId,
      name: args.name,
      source: "own",
    });
  },
});

// Undefined leaves a field as it is; null clears it (back to the seed's or the kitchen's value).
export const overrideIngredient = defineMutator({
  name: "overrideIngredient",
  args: z
    .strictObject({
      overrideId: z.uuid(),
      ingredientId: z.uuid(),
      mainUnit: unitSchema.nullable().optional(),
      shoppingCategoryId: z.uuid().nullable().optional(),
    })
    .refine((args) => args.mainUnit !== undefined || args.shoppingCategoryId !== undefined, {
      message: "Give a mainUnit or a shoppingCategoryId",
    }),
  async run(tx, args, { ownerId }) {
    await lockCatalog(tx, ownerId);
    const ingredient = await requireVisibleIngredient(tx, args.ingredientId, ownerId);
    if (
      args.mainUnit &&
      !(ingredient.preferredKind && unitFitsKind(args.mainUnit, ingredient.preferredKind as Kind))
    ) {
      throw new InvalidArgsError(
        `${args.mainUnit} is not a unit of ${ingredient.preferredKind ?? "an unknown kind"}`,
      );
    }
    if (args.shoppingCategoryId) await requireVisibleCategory(tx, args.shoppingCategoryId, ownerId);

    const changes: {
      mainUnit?: Unit | null;
      shoppingCategoryId?: string | null;
    } = {};
    if (args.mainUnit !== undefined) changes.mainUnit = args.mainUnit;
    if (args.shoppingCategoryId !== undefined) changes.shoppingCategoryId = args.shoppingCategoryId;

    if (ingredient.source === "own") {
      // The kitchen's own row is theirs to change (requireVisibleIngredient checked the owner).
      await tx
        .update(ingredients)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(and(eq(ingredients.id, ingredient.id), eq(ingredients.ownerId, ownerId)));
      return;
    }
    // A seed row is never written: the change goes in the caller's one override row.
    // `overrideId` is used only by the first insert. Later overrides of the same Ingredient
    // update that existing row and keep its id, which GET /ingredients returns as `overrideId`.
    await tx
      .insert(ingredientOverrides)
      .values({
        id: args.overrideId,
        ownerId,
        ingredientId: ingredient.id,
        ...changes,
      })
      .onConflictDoUpdate({
        target: [ingredientOverrides.ownerId, ingredientOverrides.ingredientId],
        set: { ...changes, updatedAt: sql`now()`, deletedAt: null },
      });
  },
});

// Serialises one owner's catalog writes, so two concurrent writes can't both pass the
// duplicate checks. Released when the transaction ends.
// Source: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
async function lockCatalog(tx: Tx, ownerId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`catalog:${ownerId}`}, 0))`);
}

/** A seed Ingredient, or the caller's own live one; anything else reads as missing. */
export async function requireVisibleIngredient(tx: Tx, id: string, ownerId: string) {
  const [row] = await tx
    .select({
      id: ingredients.id,
      source: ingredients.source,
      preferredKind: ingredients.preferredKind,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.id, id),
        or(
          and(isNull(ingredients.ownerId), eq(ingredients.source, "seed")),
          eq(ingredients.ownerId, ownerId),
        ),
        isNull(ingredients.deletedAt),
      ),
    );
  if (!row) throw new NotFoundError("Ingredient");
  return row;
}

async function requireVisibleCategory(tx: Tx, id: string, ownerId: string) {
  const [row] = await tx
    .select({ id: shoppingCategories.id })
    .from(shoppingCategories)
    .where(
      and(
        eq(shoppingCategories.id, id),
        or(isNull(shoppingCategories.ownerId), eq(shoppingCategories.ownerId, ownerId)),
        isNull(shoppingCategories.deletedAt),
      ),
    );
  if (!row) throw new NotFoundError("Shopping category");
}
