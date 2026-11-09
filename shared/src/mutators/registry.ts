import type { AnyMutator } from "./define.ts";
import { addAlias, createIngredient, overrideIngredient } from "./ingredients.ts";
import { addCourse, addDish, createMenu, removeDish, setDishScale } from "./menus.ts";
import {
  addStepDependency,
  removeStepDependency,
  setGroupWithPrevious,
  setMakeAhead,
  setStepTimes,
} from "./planning.ts";
import { pinTask, unpinTask } from "./pins.ts";
import { tickStep, untickStep } from "./progress.ts";
import { createRecipe, editRecipe } from "./recipes.ts";
import {
  createService,
  giveCookMoreTime,
  replanFromScratch,
  replanService,
  setAvailabilityOverride,
  setKitchenSettings,
  setServiceTime,
  setWeeklyAvailability,
} from "./services.ts";
import { markGot, unmarkGot } from "./shopping.ts";
import { addStep, editStep, moveStep, removeStep } from "./steps.ts";
import { createSubRecipe, extractToSubRecipe, setYield } from "./subrecipes.ts";

export type { AnyMutator, Mutator, MutatorContext, Tx } from "./define.ts";
export { ConflictError, defineMutator, InvalidArgsError, NotFoundError } from "./define.ts";

// Every named mutation the server accepts on POST /mutate (ADR 0007). `satisfies` keeps the
// literal keys, so `MutationName` lists them.
export const mutators = {
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
  removeDish,
  createIngredient,
  addAlias,
  overrideIngredient,
  createService,
  setServiceTime,
  replanService,
  replanFromScratch,
  setKitchenSettings,
  setWeeklyAvailability,
  setAvailabilityOverride,
  giveCookMoreTime,
  markGot,
  unmarkGot,
  tickStep,
  untickStep,
  pinTask,
  unpinTask,
} satisfies Record<string, AnyMutator>;

/** The name of a mutation the server accepts. The web imports it with `import type` only. */
export type MutationName = keyof typeof mutators;

export function getMutator(
  name: string,
  registry: Record<string, AnyMutator> = mutators,
): AnyMutator | undefined {
  // Own keys only, so "toString" or "__proto__" never resolve to something callable.
  return Object.hasOwn(registry, name) ? registry[name] : undefined;
}
