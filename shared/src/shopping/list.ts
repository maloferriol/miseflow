// The Shopping list (units spec §6, ADR 0004 MVP scope). Pure: one row per Ingredient across
// every Dish and Batch of a Service, in its Main unit, grouped by Shopping category. Derived on
// read (ADR 0010); only the Got marks are stored.
import type { deriveBatches } from "../plan/batches.ts";
import { type Amount, convert, type ConversionLookup, type Region } from "../recipe/convert.ts";
import { unitTier } from "../recipe/quantity.ts";
import type { RecipeSnapshot, SnapshotLine } from "../recipe/snapshot.ts";

/** A `conversions` row for one Ingredient: `source: "seed"` is a reference value (≈). */
export type ConversionRow = {
  fromUnit: string | null;
  toUnit: string | null;
  factor: number;
  source: "seed" | "own";
};

/** What the list needs of a catalog entry, as loadCatalog gives it (overrides merged in). */
export type ShoppingIngredient = {
  id: string;
  name: string;
  preferredKind: string | null;
  /** The override's or the Ingredient's own Main unit; null: the kitchen's unit for its kind. */
  mainUnit: string | null;
  shoppingCategory: { id: string; name: string } | null;
};

export type ShoppingInput = {
  region: Region;
  /** In Menu order. */
  dishes: { dishId: string; recipeId: string }[];
  /** Every Dish's Recipe plus every live sub-recipe they reach. */
  recipes: Map<string, RecipeSnapshot>;
  scale: ReturnType<typeof deriveBatches>;
  catalog: ShoppingIngredient[];
  /** The visible Shopping categories, in position order. */
  categories: { id: string; name: string }[];
  /** `kitchen_settings.mass_unit`, `volume_unit` and `count_unit`. */
  kitchenUnits: { mass: string; volume: string; count: string };
  conversions: (ingredientId: string) => ConversionRow[];
  /** Ingredient ids with a live Got mark for the Service. */
  got: Set<string>;
};

export type ShoppingRow = {
  ingredientId: string;
  name: string;
  /** The total in `unit`, raw (owner decision 4); null when nothing could be added up. */
  need: number | null;
  /** The Main unit; "each" for pieces. */
  unit: string | null;
  /** An Approximate total (≈). */
  approximate: boolean;
  /** Vague amounts as written ("a pinch"), never totalled. */
  vague: string[];
  /** Parts with no way into the Main unit, scaled, by unit. */
  unconverted: { amount: number; unit: string | null }[];
  got: boolean;
};

export type ShoppingList = {
  /** In position order, then "No category" (id null); only categories with rows. */
  categories: { id: string | null; name: string; rows: ShoppingRow[] }[];
  /** Lines with a Missing sub-recipe, which add nothing. */
  missing: { lineId: string; recipeName: string; wording: string | null }[];
};

// The seed and `count_unit` call a piece "each"; parseQuantity calls it null.
const piece = (unit: string | null) => (unit === "each" ? null : unit);

// The kitchen's own Conversions come before the seed's (CONTEXT "Conversion").
const ownFirst = (rows: ConversionRow[]) =>
  [...rows].sort((a, b) => (a.source === b.source ? 0 : a.source === "own" ? -1 : 1));

/** A ConversionLookup over one Ingredient's rows, the kitchen's own before the seed's. */
export function conversionLookup(rows: ConversionRow[]): ConversionLookup {
  const ordered = ownFirst(rows);
  return (from, to) => {
    const row = ordered.find((r) => piece(r.fromUnit) === from && piece(r.toUnit) === to);
    return row ? { factor: row.factor, source: row.source } : null;
  };
}

// `amount` in `to`: exactly or through a direct Conversion (convert), else through a Conversion
// with each side converted within its kind (cup → ml → g, each → g → kg).
function toUnit(amount: Amount, to: string | null, region: Region, rows: ConversionRow[]) {
  const lookup = conversionLookup(rows);
  const direct = convert(amount, to, region, lookup);
  if (direct) return direct;
  for (const row of ownFirst(rows)) {
    const before = convert(amount, piece(row.fromUnit), region);
    if (!before) continue;
    const after = convert(
      { value: before.value * row.factor, unit: piece(row.toUnit) },
      to,
      region,
    );
    if (after) return { value: after.value, approximate: row.source === "seed" };
  }
  return null;
}

const PLURALS: Record<string, string> = { pinch: "pinches", dash: "dashes", handful: "handfuls" };

/** A Vague amount as the cook wrote it: "a pinch", "2 pinches", "to taste". */
export function vagueText(line: Pick<SnapshotLine, "quantity" | "unit">): string {
  const { quantity, unit } = line;
  if (unit === null) return quantity === null ? "no amount" : String(quantity);
  if (unit === "to taste") return unit;
  if (quantity === null) return `a ${unit}`;
  return `${quantity} ${quantity === 1 ? unit : (PLURALS[unit] ?? unit)}`;
}

const linesOf = (recipe: RecipeSnapshot) => recipe.steps.flatMap((s) => s.lines);

export function deriveShoppingList(input: ShoppingInput): ShoppingList {
  const { recipes, region, scale } = input;
  const catalog = new Map(input.catalog.map((i) => [i.id, i]));
  const rows = new Map<string, ShoppingRow>();
  const missing: ShoppingList["missing"] = [];
  const seenMissing = new Set<string>();

  const mainUnit = (ingredient: ShoppingIngredient | undefined) => {
    if (ingredient?.mainUnit) return ingredient.mainUnit;
    const kind = ingredient?.preferredKind;
    return kind === "mass" || kind === "volume" || kind === "count"
      ? input.kitchenUnits[kind]
      : null;
  };

  // One line at `factor`; `estimated` when its Batch's size was assumed.
  const add = (recipe: RecipeSnapshot, line: SnapshotLine, factor: number, estimated: boolean) => {
    if (line.ingredientId === null) {
      // A sub-recipe line comes through its Batch; one to a Recipe the list can't find is Missing.
      if (line.subRecipeId !== null && recipes.has(line.subRecipeId)) return;
      if (!seenMissing.has(line.id))
        missing.push({ lineId: line.id, recipeName: recipe.name, wording: line.wording });
      seenMissing.add(line.id);
      return;
    }
    const ingredient = catalog.get(line.ingredientId);
    const unit = mainUnit(ingredient);
    let row = rows.get(line.ingredientId);
    if (!row) {
      row = {
        ingredientId: line.ingredientId,
        name: ingredient?.name ?? line.wording ?? "",
        need: null,
        unit,
        approximate: false,
        vague: [],
        unconverted: [],
        got: input.got.has(line.ingredientId),
      };
      rows.set(line.ingredientId, row);
    }
    // A range counts its upper end (§6).
    const amount = line.quantityMax ?? line.quantity;
    if (amount === null || unitTier(line.unit) === "vague") {
      row.vague.push(vagueText(line));
      return;
    }
    const value = amount * (line.fixedQuantity ? 1 : factor);
    const converted =
      unit === null
        ? null
        : toUnit(
            { value, unit: line.unit },
            piece(unit),
            region,
            input.conversions(line.ingredientId),
          );
    if (!converted) {
      const part = row.unconverted.find((p) => p.unit === line.unit);
      if (part) part.amount += value;
      else row.unconverted.push({ amount: value, unit: line.unit });
      return;
    }
    row.need = (row.need ?? 0) + converted.value;
    row.approximate ||= converted.approximate || estimated;
  };

  const factorOfDish = new Map(scale.dishes.map((d) => [d.dishId, d.factor]));
  for (const dish of input.dishes) {
    const recipe = recipes.get(dish.recipeId);
    if (!recipe) continue;
    for (const line of linesOf(recipe)) add(recipe, line, factorOfDish.get(dish.dishId)!, false);
  }

  // A Batch is estimated when it couldn't be scaled, or a parent Batch was (spec §5).
  const batches = new Map(scale.batches.map((b) => [b.subRecipeId, b]));
  const estimated = new Map<string, boolean>();
  const isEstimated = (id: string): boolean => {
    if (!estimated.has(id)) {
      const b = batches.get(id)!;
      estimated.set(
        id,
        !b.scalable || b.parents.some((p) => p.kind === "batch" && isEstimated(p.id)),
      );
    }
    return estimated.get(id)!;
  };
  for (const b of scale.batches) {
    const recipe = recipes.get(b.subRecipeId)!;
    for (const line of linesOf(recipe)) add(recipe, line, b.factor, isEstimated(b.subRecipeId));
  }

  const byName = (a: ShoppingRow, b: ShoppingRow) =>
    a.name.localeCompare(b.name) || (a.ingredientId < b.ingredientId ? -1 : 1);
  const all = [...rows.values()];
  const known = new Set(input.categories.map((c) => c.id));
  const categoryOf = (row: ShoppingRow) => {
    const id = catalog.get(row.ingredientId)?.shoppingCategory?.id ?? null;
    return id !== null && known.has(id) ? id : null;
  };
  const categories: ShoppingList["categories"] = [
    ...input.categories.map((c) => ({ id: c.id, name: c.name })),
    { id: null, name: "No category" },
  ]
    .map((c) => ({ ...c, rows: all.filter((r) => categoryOf(r) === c.id).sort(byName) }))
    .filter((c) => c.rows.length);
  return { categories, missing };
}
