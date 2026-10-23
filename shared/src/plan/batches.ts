// Scaling and Batch sizing (units spec §5, spec §3 Batches). Pure: a Dish's Scale factor, and one
// Batch per sub-recipe its Recipes reach, sized to everything its parents use after their own
// scaling, converted into its yield unit and divided by its yield, recursively.
import { convert, type Region } from "../recipe/convert.ts";
import { unitTier } from "../recipe/quantity.ts";
import type { RecipeSnapshot, SnapshotLine } from "../recipe/snapshot.ts";

export type ScaleInput = {
  guestCount: number | null;
  region: Region;
  /** In Menu order: Course, then Dish position. */
  dishes: { dishId: string; recipeId: string; scaleFactor: number | null }[];
  /** Every Dish's Recipe plus every live sub-recipe they reach. A line to any other id is a Missing sub-recipe. */
  recipes: Map<string, RecipeSnapshot>;
};

/** What the cook can do so a scale can be worked out: "add a yield", "add a yield in g", "add servings". */
export type Fix = { subRecipeId: string | null; subRecipeName: string | null; text: string };

export type DishScale = { dishId: string; factor: number; source: "guests" | "set" | "assumed"; fixes: Fix[] };

export type BatchParent = { kind: "dish" | "batch"; id: string; name: string };

export type BatchSize = {
  subRecipeId: string;
  name: string;
  /** 1 when it can't be worked out. Exact: only labels round. */
  factor: number;
  scalable: boolean;
  /** Direct users, a Dish id or a parent sub-recipe id, in Menu order of first use. */
  parents: BatchParent[];
  fix: string | null;
};

type Parent = { kind: "dish"; dishId: string; recipeId: string } | { kind: "batch"; recipeId: string };

function dishScale(input: ScaleInput, d: ScaleInput["dishes"][number]): DishScale {
  if (d.scaleFactor !== null) return { dishId: d.dishId, factor: d.scaleFactor, source: "set", fixes: [] };
  const servings = input.recipes.get(d.recipeId)?.servings ?? null;
  if (servings && servings > 0 && input.guestCount !== null)
    return { dishId: d.dishId, factor: input.guestCount / servings, source: "guests", fixes: [] };
  return { dishId: d.dishId, factor: 1, source: "assumed", fixes: [{ subRecipeId: null, subRecipeName: null, text: "add servings" }] };
}

const parentKey = (p: Parent) => (p.kind === "dish" ? `dish:${p.dishId}` : `batch:${p.recipeId}`);
const linesOf = (recipe: RecipeSnapshot) => recipe.steps.flatMap((s) => s.lines);

// How many batches of `child` one parent line asks for at `factor`, or the fix when it can't say.
function batchesFor(line: SnapshotLine, factor: number, child: RecipeSnapshot, region: Region): number | string {
  // A range counts its upper end, as the Shopping list does (§6).
  const amount = line.quantityMax ?? line.quantity;
  const times = line.fixedQuantity ? 1 : factor;
  if (line.unit === "servings") {
    if (amount === null || !child.servings) return "add servings";
    return (amount * times) / child.servings;
  }
  if (!child.yield) return "add a yield";
  if (amount === null) return "add a yield";
  const yieldUnit = child.yield.unit;
  if (line.unit === null) {
    // No unit: yield pieces when the yield is counted, else whole batches.
    if (unitTier(yieldUnit) === "ingredient") return (amount * times) / child.yield.quantity;
    return amount * times;
  }
  const converted = convert({ value: amount, unit: line.unit }, yieldUnit, region);
  if (!converted) return `add a yield in ${line.unit}`;
  return (converted.value * times) / child.yield.quantity;
}

export function deriveBatches(input: ScaleInput): { dishes: DishScale[]; batches: BatchSize[] } {
  const { recipes, region } = input;
  const dishes = input.dishes.map((d) => dishScale(input, d));

  // Every reachable sub-recipe, in Menu order of first use, with its direct parents.
  const order: string[] = [];
  const parentsOf = new Map<string, Parent[]>();
  const visit = (parent: Parent) => {
    for (const line of linesOf(recipes.get(parent.recipeId)!)) {
      const child = line.subRecipeId;
      if (child === null || !recipes.has(child)) continue; // A Missing sub-recipe is skipped.
      const known = parentsOf.has(child);
      if (!known) parentsOf.set(child, []);
      const list = parentsOf.get(child)!;
      if (!list.some((p) => parentKey(p) === parentKey(parent))) list.push(parent);
      if (!known) {
        order.push(child);
        visit({ kind: "batch", recipeId: child });
      }
    }
  };
  for (const d of input.dishes) if (recipes.has(d.recipeId)) visit({ kind: "dish", dishId: d.dishId, recipeId: d.recipeId });

  // Parents before children (Kahn), the earliest first use first among those ready.
  const pending = new Map(order.map((id) => [id, parentsOf.get(id)!.filter((p) => p.kind === "batch").length]));
  const childrenOf = new Map<string, string[]>();
  for (const id of order)
    for (const p of parentsOf.get(id)!) if (p.kind === "batch") childrenOf.set(p.recipeId, [...(childrenOf.get(p.recipeId) ?? []), id]);
  const sizes = new Map<string, BatchSize>();
  const factorOfDish = new Map(dishes.map((d) => [d.dishId, d.factor]));
  while (pending.size) {
    const id = order.find((o) => pending.get(o) === 0);
    // #84 refuses cycles when a line is linked; this only guards against bad input.
    if (id === undefined) throw new Error(`Sub-recipe cycle through ${[...pending.keys()].join(", ")}`);
    pending.delete(id);
    const child = recipes.get(id)!;
    let total = 0;
    let fix: string | null = null;
    for (const p of parentsOf.get(id)!) {
      const factor = p.kind === "dish" ? factorOfDish.get(p.dishId)! : sizes.get(p.recipeId)!.factor;
      for (const line of linesOf(recipes.get(p.recipeId)!)) {
        if (line.subRecipeId !== id) continue;
        const n = batchesFor(line, factor, child, region);
        if (typeof n === "string") fix ??= n;
        else total += n;
      }
    }
    sizes.set(id, {
      subRecipeId: id,
      name: child.name,
      factor: fix === null ? total : 1,
      scalable: fix === null,
      parents: parentsOf.get(id)!.map((p) =>
        p.kind === "dish"
          ? { kind: "dish", id: p.dishId, name: recipes.get(p.recipeId)!.name }
          : { kind: "batch", id: p.recipeId, name: recipes.get(p.recipeId)!.name },
      ),
      fix,
    });
    for (const c of childrenOf.get(id) ?? []) pending.set(c, pending.get(c)! - 1);
  }

  // Each Dish that reaches a Batch that can't scale, directly or through parent Batches, gets its fix.
  const reaches = (dishId: string, recipeId: string, seen = new Set<string>()): string[] => {
    const out: string[] = [];
    for (const line of linesOf(recipes.get(recipeId)!)) {
      const child = line.subRecipeId;
      if (child === null || !sizes.has(child) || seen.has(child)) continue;
      seen.add(child);
      out.push(child, ...reaches(dishId, child, seen));
    }
    return out;
  };
  input.dishes.forEach((d, i) => {
    if (!recipes.has(d.recipeId)) return;
    for (const id of reaches(d.dishId, d.recipeId)) {
      const b = sizes.get(id)!;
      if (b.fix !== null) dishes[i]!.fixes.push({ subRecipeId: id, subRecipeName: b.name, text: b.fix });
    }
  });

  return { dishes, batches: order.map((id) => sizes.get(id)!) };
}

const factorFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

/** "×1.5", "×1.33": rounded to 2 decimals for display only. */
export function formatFactor(factor: number): string {
  return `×${factorFormat.format(factor)}`;
}

/** "Chicken stock ×1.5 · for: Velouté, Beurre blanc", everywhere a Batch shows (spec §3). */
export function batchLabel(b: BatchSize): string {
  return `${b.name} ${formatFactor(b.factor)} · for: ${b.parents.map((p) => p.name).join(", ")}`;
}
