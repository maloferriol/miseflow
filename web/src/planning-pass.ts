// The Planning pass's decisions (ADR 0011): pure functions the hook and the view pass through.
import type { Recipe, RecipeStep } from "./api.ts";
import type { Intent } from "./intent.ts";
import type { MutationCall } from "./menu-screen.ts";
import { stepLabel } from "./ReadyToPlan.tsx";

/** A make-ahead window: made `beforeDays` before Service, kept `shelfLifeDays` once made. */
export type Window = { beforeDays: number; shelfLifeDays: number };

/** What a make-ahead window is set on: the whole Recipe, or one Step. */
export type Target = { kind: "recipe"; recipeId: string } | { kind: "step"; stepId: string };

export type StepTimes = { activeMinutes: number | null; passiveMinutes: number | null };

// An empty field is "not set"; anything else goes to the server as typed, which validates it.
function numberOrNull(text: string) {
  const trimmed = text.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** A Step's times form as what to save: an empty field is no time. */
export function stepTimesInput(activeMinutes: string, passiveMinutes: string): StepTimes {
  return {
    activeMinutes: numberOrNull(activeMinutes),
    passiveMinutes: numberOrNull(passiveMinutes),
  };
}

/** A window form as what to save. Its fields are required, so the browser lets no empty one through. */
export function windowInput(beforeDays: string, shelfLifeDays: string): Window {
  return { beforeDays: Number(beforeDays), shelfLifeDays: Number(shelfLifeDays) };
}

/** What a Step without its own window shows: the window it inherits, or Last-minute. */
export function inheritedWindowText(effective: Window | null): string {
  return effective
    ? `Inherits ${effective.beforeDays} days ahead · keeps ${effective.shelfLifeDays} days`
    : "Last-minute";
}

/** Whether a Step's row opens with its own window ticked: when it has one saved. */
export function opensOwnWindow(step: Pick<RecipeStep, "makeAhead">): boolean {
  return step.makeAhead !== null;
}

/**
 * Whether ticking or unticking "Own make-ahead window" clears the Step's window. Unticking a
 * saved window makes the Step inherit its Recipe's again; unticking one never saved sends nothing.
 */
export function clearsOwnWindow(checked: boolean, step: Pick<RecipeStep, "makeAhead">): boolean {
  return !checked && step.makeAhead !== null;
}

/** Whether "Group with previous Step" shows ticked: the first Step has no previous Step. */
export function groupsWithPrevious(step: Pick<RecipeStep, "groupWithPrevious">, index: number) {
  return step.groupWithPrevious && index > 0;
}

function labelOf(recipe: Pick<Recipe, "steps">, stepId: string) {
  const at = recipe.steps.findIndex((s) => s.id === stepId);
  return stepLabel(recipe.steps[at], at);
}

/** The Steps a Step can wait for: every other Step of the Recipe, by its label. */
export function linkChoices(
  recipe: Pick<Recipe, "steps">,
  stepId: string,
): { id: string; label: string }[] {
  return recipe.steps
    .filter((s) => s.id !== stepId)
    .map((s) => ({ id: s.id, label: labelOf(recipe, s.id) }));
}

/** The links a Step waits for, each with its id (to remove it) and its before Step's label. */
export function waitsFor(
  recipe: Pick<Recipe, "steps" | "dependencies">,
  stepId: string,
): { id: string; label: string }[] {
  return recipe.dependencies
    .filter((d) => d.afterStepId === stepId)
    .map((d) => ({ id: d.id, label: labelOf(recipe, d.beforeStepId) }));
}

// One set of ids per intended save, keyed on its name and args, so a retry after a lost response
// replays it (useIntent). Every Planning pass mutation appends one Revision.
function revisionCall<A extends object>(
  name: string,
  args: A,
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify([name, args]);
  return {
    id: intent.id(key, "mutation"),
    name,
    args: { revisionId: intent.id(key, "revision"), ...args },
  };
}

/** Sets a Step's active and passive minutes. */
export function stepTimesSave(
  args: { stepId: string } & StepTimes,
  intent: Pick<Intent, "id">,
): MutationCall {
  return revisionCall("setStepTimes", args, intent);
}

/** Sets or clears (`window: null`) a make-ahead window on the Recipe or one Step. */
export function makeAheadSave(
  args: { target: Target; window: Window | null },
  intent: Pick<Intent, "id">,
): MutationCall {
  return revisionCall("setMakeAhead", args, intent);
}

/** Groups a Step with the one before it into one Task, or ungroups it. */
export function groupSave(
  args: { stepId: string; value: boolean },
  intent: Pick<Intent, "id">,
): MutationCall {
  return revisionCall("setGroupWithPrevious", args, intent);
}

/** Makes one Step wait for another, with a new link id that a retry keeps. */
export function addLinkSave(
  args: { beforeStepId: string; afterStepId: string },
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify(["addStepDependency", args]);
  const call = revisionCall("addStepDependency", args, intent);
  return { ...call, args: { ...call.args, dependencyId: intent.id(key, "dependency") } };
}

/** Removes a link by the id the Recipe read returns: a re-added pair keeps its old id. */
export function removeLinkSave(dependencyId: string, intent: Pick<Intent, "id">): MutationCall {
  return revisionCall("removeStepDependency", { dependencyId }, intent);
}
