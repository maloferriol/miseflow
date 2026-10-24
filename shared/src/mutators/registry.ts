import type { Mutator } from "./define.ts";
import {
  addAlias,
  createIngredient,
  overrideIngredient,
} from "./ingredients.ts";
import { addCourse, addDish, createMenu, setDishScale } from "./menus.ts";
import {
  addStepDependency,
  removeStepDependency,
  setGroupWithPrevious,
  setMakeAhead,
  setStepTimes,
} from "./planning.ts";
import { pinTask } from "./pins.ts";
import { tickStep, untickStep } from "./progress.ts";
import { createRecipe, editRecipe } from "./recipes.ts";
import {
  createService,
  replanService,
  setAvailabilityOverride,
  setKitchenSettings,
  setServiceTime,
  setWeeklyAvailability,
} from "./services.ts";
import { markGot, unmarkGot } from "./shopping.ts";
import { addStep, editStep, moveStep, removeStep } from "./steps.ts";
import {
  createSubRecipe,
  extractToSubRecipe,
  setYield,
} from "./subrecipes.ts";

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
  setYield,
  extractToSubRecipe,
  addDish,
  setDishScale,
  createIngredient,
  addAlias,
  overrideIngredient,
  createService,
  setServiceTime,
  replanService,
  setKitchenSettings,
  setWeeklyAvailability,
  setAvailabilityOverride,
  markGot,
  unmarkGot,
  tickStep,
  untickStep,
  pinTask,
};

export function getMutator(
  name: string,
  registry: Record<string, Mutator<any>> = mutators,
): Mutator<any> | undefined {
  // Own keys only, so "toString" or "__proto__" never resolve to something callable.
  return Object.hasOwn(registry, name) ? registry[name] : undefined;
}
