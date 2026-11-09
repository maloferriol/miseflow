// The Planning pass (ADR 0011): its hook, and the component that renders its view with it.
import { useQueryClient } from "@tanstack/react-query";
import type { Recipe } from "./api.ts";
import { useIntent } from "./intent.ts";
import {
  addLinkSave,
  groupSave,
  makeAheadSave,
  removeLinkSave,
  type StepTimes,
  stepTimesSave,
  type Window,
} from "./planning-pass.ts";
import { PlanningPassView } from "./PlanningPassView.tsx";
import { useIntentSave } from "./use-intent-save.ts";

/**
 * The Planning pass's five mutations, each with its own intent. The Steps' rows share them with
 * the Recipe's window, so a pending save turns off its controls in every row, and one error shows
 * for the whole pass. Only query-client, intent and mutation hooks: no branches.
 */
export function usePlanningPass(recipe: Recipe) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["recipe", recipe.id] });

  // One intent slot per mutation, so a retry after a lost response replays that save's ids
  // whatever the others sent or saved in between.
  const setStepTimes = useIntentSave(useIntent(), stepTimesSave, invalidate);
  const setMakeAhead = useIntentSave(useIntent(), makeAheadSave, invalidate);
  const setGroupWithPrevious = useIntentSave(useIntent(), groupSave, invalidate);
  const addStepDependency = useIntentSave(useIntent(), addLinkSave, invalidate);
  const removeStepDependency = useIntentSave(useIntent(), removeLinkSave, invalidate);
  const error =
    [
      setStepTimes,
      setMakeAhead,
      setGroupWithPrevious,
      addStepDependency,
      removeStepDependency,
    ].find((m) => m.error)?.error ?? null;

  return {
    pending: {
      times: setStepTimes.isPending,
      window: setMakeAhead.isPending,
      group: setGroupWithPrevious.isPending,
      addLink: addStepDependency.isPending,
      removeLink: removeStepDependency.isPending,
    },
    error,
    onRecipeWindow: (window: Window | null) =>
      setMakeAhead.mutate({ target: { kind: "recipe", recipeId: recipe.id }, window }),
    onStepTimes: (stepId: string, times: StepTimes) => setStepTimes.mutate({ stepId, ...times }),
    onStepWindow: (stepId: string, window: Window | null) =>
      setMakeAhead.mutate({ target: { kind: "step", stepId }, window }),
    onGroup: (stepId: string, value: boolean) => setGroupWithPrevious.mutate({ stepId, value }),
    onAddLink: (stepId: string, beforeStepId: string) =>
      addStepDependency.mutate({ beforeStepId, afterStepId: stepId }),
    onRemoveLink: (dependencyId: string) => removeStepDependency.mutate(dependencyId),
  };
}

export function PlanningPass({ recipe }: Readonly<{ recipe: Recipe }>) {
  return <PlanningPassView {...usePlanningPass(recipe)} recipe={recipe} />;
}
