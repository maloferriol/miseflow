// The Shopping list's decisions (ADR 0011): pure functions the hooks and the views pass through.
import type { ShoppingList } from "./api.ts";
import type { Intent } from "./intent.ts";
import type { MutationCall } from "./menu-screen.ts";

/**
 * Marks a row Got (markGot) or un-Got (unmarkGot). Each intended state keeps its own ids, so a
 * retry of the same tick replays, and the mark's id is made once with the mutation's.
 */
export function gotSave(
  serviceId: string,
  ingredientId: string,
  got: boolean,
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify([ingredientId, got]);
  const id = intent.id(key, "mutation");
  return got
    ? { id, name: "markGot", args: { markId: intent.id(key, "mark"), serviceId, ingredientId } }
    : { id, name: "unmarkGot", args: { serviceId, ingredientId } };
}

/** The tick box's state: the one the cook just set until the list reloads, else the saved one. */
export function rowChecked(intended: boolean | null, got: boolean): boolean {
  return intended ?? got;
}

/** One Missing sub-recipe's line on top of the list. */
export function missingText(missing: ShoppingList["missing"][number]): string {
  return `${missing.recipeName}: ${missing.wording ?? "a sub-recipe"} is a Missing sub-recipe and adds nothing to this list`;
}
