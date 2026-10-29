// The Recipes list (ADR 0011): its hook, and the screen that renders its view with it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRecipes, mutate } from "./api.ts";
import { RecipesView } from "./RecipesViews.tsx";

/** The Recipes, and a create that opens the new Recipe. Only query and mutation hooks: no branches. */
export function useRecipesScreen(onOpen: (recipeId: string) => void) {
  const queryClient = useQueryClient();
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: fetchRecipes });
  const createRecipe = useMutation({
    mutationFn: async (name: string) => {
      const recipeId = crypto.randomUUID();
      await mutate(crypto.randomUUID(), "createRecipe", {
        recipeId,
        revisionId: crypto.randomUUID(),
        name,
      });
      return recipeId;
    },
    onSuccess: async (recipeId) => {
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      onOpen(recipeId);
    },
  });
  return {
    recipes,
    createPending: createRecipe.isPending,
    createError: createRecipe.error,
    onCreate: (name: string) => createRecipe.mutate(name),
  };
}

export function RecipesScreen({ onOpen }: Readonly<{ onOpen: (recipeId: string) => void }>) {
  return <RecipesView {...useRecipesScreen(onOpen)} onOpen={onOpen} />;
}
