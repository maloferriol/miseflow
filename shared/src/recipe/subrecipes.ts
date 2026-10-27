// Sub-recipes (units spec §5): a Recipe used as a component of another Recipe. Pure, so the
// mutators, the read and the editor all share one answer.
import { isValidQuantity, parseQuantity } from "./quantity.ts";

/** Parent Recipe id → the Recipes its live lines use as sub-recipes. */
export type SubRecipeEdges = Map<string, Set<string>>;

/** A Recipe's yield: the Quantity it makes. A null unit means pieces. */
export type Yield = { quantity: number; unit: string | null };

/**
 * The path parent → child → … → parent that linking `childId` into `parentId` would close, or
 * null when the link is fine. A self-link is [parent, parent].
 */
export function findSubRecipeCycle(
  edges: SubRecipeEdges,
  parentId: string,
  childId: string,
): string[] | null {
  if (parentId === childId) return [parentId, parentId];
  // Depth-first from the child: a path back to the parent closes a cycle.
  const seen = new Set<string>();
  const walk = (id: string): string[] | null => {
    if (id === parentId) return [id];
    if (seen.has(id)) return null;
    seen.add(id);
    for (const next of edges.get(id) ?? []) {
      const rest = walk(next);
      if (rest) return [id, ...rest];
    }
    return null;
  };
  const path = walk(childId);
  return path ? [parentId, ...path] : null;
}

/** A line with no target, or whose sub-recipe isn't one of the owner's live Recipes. */
export function isMissingSubRecipe(
  line: { ingredientId: string | null; subRecipeId: string | null },
  liveRecipeIds: Set<string>,
): boolean {
  if (line.ingredientId !== null) return false;
  return line.subRecipeId === null || !liveRecipeIds.has(line.subRecipeId);
}

/** True when `selected` is a non-empty run of neighbours in `ordered`. */
export function areConsecutive(ordered: string[], selected: string[]): boolean {
  const wanted = new Set(selected);
  if (!wanted.size) return false;
  const indexes = [...wanted].map((id) => ordered.indexOf(id));
  if (indexes.some((i) => i < 0)) return false;
  return Math.max(...indexes) - Math.min(...indexes) + 1 === wanted.size;
}

/** "1.5 L", "24", "500%g". Refuses a vague amount, a range, the "=" flag and zero (Q6). */
export function parseYield(text: string): Yield {
  const q = parseQuantity(text);
  if (
    q.value === null ||
    q.max !== null ||
    q.fixed ||
    q.tier === "vague" ||
    !isValidQuantity(q) ||
    q.value <= 0
  )
    throw new Error("A yield is one amount, like 1.5 L, 500 g or 24: not vague, a range, or fixed");
  return { quantity: q.value, unit: q.unit };
}
