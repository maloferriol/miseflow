// The yield field (ADR 0011): its hook, and the field that renders its view with it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mutate, type Recipe } from "./api.ts";
import { useIntent } from "./intent.ts";
import { yieldSave } from "./recipe-screen.ts";
import { YieldFieldView } from "./RecipeViews.tsx";

/** Saves a Recipe's yield. Only query-client, intent and mutation hooks: no branches. */
export function useYieldField(recipeId: string) {
  const queryClient = useQueryClient();
  // One set of ids per intended save, so a retry after a lost response replays it (useIntent).
  const intent = useIntent();
  const setYield = useMutation({
    mutationFn: async (value: string | null) => {
      const call = yieldSave(recipeId, value, intent);
      await mutate(call.id, call.name, call.args);
    },
    onSuccess: async () => {
      intent.reset();
      await queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
  });
  return {
    savePending: setYield.isPending,
    saveError: setYield.error,
    onSave: (value: string | null) => setYield.mutate(value),
  };
}

// The Quantity the Recipe makes (#84). A Recipe used as a sub-recipe needs one (units spec §5).
export function YieldField({ recipe }: Readonly<{ recipe: Recipe }>) {
  return <YieldFieldView {...useYieldField(recipe.id)} recipe={recipe} />;
}
