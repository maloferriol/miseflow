// The Planning pass (ADR 0011): its hook, and the component that renders its view with it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mutate, type Recipe } from "./api.ts";
import { useIntent } from "./intent.ts";
import type { MutationCall } from "./menu-screen.ts";
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

/**
 * The Planning pass's five mutations. The Steps' rows share them with the Recipe's window, so one
 * save pending disables both windows' buttons and one error shows for the whole pass. Only
 * query-client, intent and mutation hooks: no branches.
 */
export function usePlanningPass(recipe: Recipe) {
  const queryClient = useQueryClient();
  // One intent slot for the pass: a retry after a lost response replays the same save.
  const intent = useIntent();
  const send = (call: MutationCall) => mutate(call.id, call.name, call.args);
  const onSuccess = async () => {
    intent.reset();
    await queryClient.invalidateQueries({ queryKey: ["recipe", recipe.id] });
  };

  const setStepTimes = useMutation({
    mutationFn: (args: { stepId: string } & StepTimes) => send(stepTimesSave(args, intent)),
    onSuccess,
  });
  const setMakeAhead = useMutation({
    mutationFn: (args: Parameters<typeof makeAheadSave>[0]) => send(makeAheadSave(args, intent)),
    onSuccess,
  });
  const setGroupWithPrevious = useMutation({
    mutationFn: (args: { stepId: string; value: boolean }) => send(groupSave(args, intent)),
    onSuccess,
  });
  const addStepDependency = useMutation({
    mutationFn: (args: { beforeStepId: string; afterStepId: string }) =>
      send(addLinkSave(args, intent)),
    onSuccess,
  });
  const removeStepDependency = useMutation({
    mutationFn: (dependencyId: string) => send(removeLinkSave(dependencyId, intent)),
    onSuccess,
  });
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
