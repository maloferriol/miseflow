// The Recipe screen (ADR 0011): its hook, and the screen that renders its view with it and fills
// the view's slots with the yield field, the Planning pass, the Step editors and Extract.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchRecipe, mutate } from "./api.ts";
import { ExtractToSubRecipe } from "./ExtractToSubRecipe.tsx";
import { PlanningPass } from "./PlanningPass.tsx";
import { recipeEdits } from "./recipe-edits.ts";
import {
  liveSelection,
  type Mode,
  modeFromSearch,
  searchWithMode,
  toggleSelection,
} from "./recipe-screen.ts";
import { RecipeScreenView } from "./RecipeViews.tsx";
import { StepEditor } from "./StepEditor.tsx";
import { YieldField } from "./YieldField.tsx";

/**
 * One Recipe, its mode (kept in the URL), the ticked Steps, and its edits. Only state, query,
 * mutation and query-client hooks: no branches.
 */
export function useRecipeScreen(recipeId: string) {
  const queryClient = useQueryClient();
  const recipe = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => fetchRecipe(recipeId),
  });
  const [adding, setAdding] = useState(false);
  // Steps ticked for Extract to sub-recipe.
  const [selected, setSelected] = useState<string[]>([]);
  // Write or Plan, kept in the URL (&mode=plan) so a reload stays in it.
  const [mode, setMode] = useState(() => modeFromSearch(window.location.search));
  // Each edit replays on a retry after a lost response, with its own ids (recipe-edits.ts).
  const edits = useMemo(() => recipeEdits(recipeId, mutate), [recipeId]);
  // After a failure too: the server may hold the edit though the response was lost (#127 B).
  const refetch = async () => {
    await queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
    await queryClient.invalidateQueries({ queryKey: ["recipes"] });
  };

  const editRecipe = useMutation({ mutationFn: edits.editRecipe, onSettled: refetch });
  const moveStep = useMutation({ mutationFn: edits.moveStep, onSettled: refetch });
  const removeStep = useMutation({ mutationFn: edits.removeStep, onSettled: refetch });

  const stepIds = recipe.data?.steps.map((s) => s.id) ?? [];
  return {
    recipe,
    mode,
    onMode: (next: Mode) => {
      window.history.replaceState(null, "", searchWithMode(window.location.search, next));
      setMode(next);
    },
    selected: liveSelection(stepIds, selected),
    onSelect: (stepId: string, checked: boolean) =>
      setSelected((prev) => toggleSelection(prev, stepId, checked)),
    onClearSelection: () => setSelected([]),
    adding,
    onAdding: setAdding,
    editPending: editRecipe.isPending,
    editError: editRecipe.error,
    onEdit: (args: { name: string; servings: number | null }) => editRecipe.mutate(args),
    movePending: moveStep.isPending,
    moveError: moveStep.error,
    onMove: (args: { stepId: string; afterStepId: string | null }) => moveStep.mutate(args),
    removePending: removeStep.isPending,
    removeError: removeStep.error,
    onRemove: (stepId: string) => removeStep.mutate(stepId),
  };
}

export function RecipeScreen({ recipeId }: Readonly<{ recipeId: string }>) {
  return (
    <RecipeScreenView
      {...useRecipeScreen(recipeId)}
      renderYield={(recipe) => <YieldField recipe={recipe} />}
      renderPlanningPass={(recipe) => <PlanningPass recipe={recipe} />}
      renderStep={(step) => <StepEditor recipeId={recipeId} step={step} />}
      renderNewStep={(onClose) => <StepEditor recipeId={recipeId} onClose={onClose} />}
      renderExtract={(extract) => <ExtractToSubRecipe recipeId={recipeId} {...extract} />}
    />
  );
}
