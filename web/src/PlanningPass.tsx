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
 * The Planning pass's five mutations. The Steps' rows share them with the Recipe's window, so one
 * save pending disables both windows' buttons and one error shows for the whole pass. Only
 * query-client, intent and mutation hooks: no branches.
 */
export function usePlanningPass(recipe: Recipe) {
  const queryClient = useQueryClient();
  // One intent slot for the pass: a retry after a lost response replays the same save.
  const intent = useIntent();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["recipe", recipe.id] });

  const setStepTimes = useIntentSave(intent, stepTimesSave, invalidate);
  const setMakeAhead = useIntentSave(intent, makeAheadSave, invalidate);
  const setGroupWithPrevious = useIntentSave(intent, groupSave, invalidate);
  const addStepDependency = useIntentSave(intent, addLinkSave, invalidate);
  const removeStepDependency = useIntentSave(intent, removeLinkSave, invalidate);
  const error =
    [
      setStepTimes,
      setMakeAhead,
      setGroupWithPrevious,
      addStepDependency,
      removeStepDependency,
    ].find((m) => m.error)?.error ?? null;

  return {
    windowPending: setMakeAhead.isPending,
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
