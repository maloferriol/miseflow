import type { Mutator } from "./define.ts";
import {
  addAlias,
  createIngredient,
  overrideIngredient,
} from "./ingredients.ts";
import { addCourse, addDish, createMenu } from "./menus.ts";
import {
  addStepDependency,
  removeStepDependency,
  setGroupWithPrevious,
  setMakeAhead,
  setStepTimes,
} from "./planning.ts";
import { createRecipe, editRecipe } from "./recipes.ts";
import { addStep, editStep, moveStep, removeStep } from "./steps.ts";
import { createSubRecipe } from "./subrecipes.ts";

export type { Mutator, MutatorContext, Tx } from "./define.ts";
export {
  ConflictError,
  defineMutator,
  InvalidArgsError,
  NotFoundError,
} from "./define.ts";

// Every named mutation the server accepts on POST /mutate (ADR 0007).
export const mutators: Record<string, Mutator<any>> = {
  createMenu,
  addCourse,
  createRecipe,
  editRecipe,
  addStep,
  editStep,
  moveStep,
  removeStep,
  setStepTimes,
  setMakeAhead,
  setGroupWithPrevious,
  addStepDependency,
  removeStepDependency,
  createSubRecipe,
  addDish,
  createIngredient,
  addAlias,
  overrideIngredient,
};

export function getMutator(
  name: string,
  registry: Record<string, Mutator<any>> = mutators,
): Mutator<any> | undefined {
  // Own keys only, so "toString" or "__proto__" never resolve to something callable.
  return Object.hasOwn(registry, name) ? registry[name] : undefined;
}
