import type { Mutator } from "./define.ts";
import { addCourse, addDish, createMenu } from "./menus.ts";
import { createRecipe } from "./recipes.ts";

export type { Mutator, MutatorContext, Tx } from "./define.ts";
export { defineMutator, NotFoundError } from "./define.ts";

// Every named mutation the server accepts on POST /mutate (ADR 0007).
export const mutators: Record<string, Mutator<any>> = {
  createMenu,
  addCourse,
  createRecipe,
  addDish,
};

export function getMutator(
  name: string,
  registry: Record<string, Mutator<any>> = mutators,
): Mutator<any> | undefined {
  // Own keys only, so "toString" or "__proto__" never resolve to something callable.
  return Object.hasOwn(registry, name) ? registry[name] : undefined;
}
