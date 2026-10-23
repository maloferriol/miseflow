import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { fetchRecipes, mutate } from "./api.ts";

// The kitchen's Recipes, by name, and a "New Recipe" form (#83 Decision 8).
export function RecipesScreen({
  onOpen,
}: {
  onOpen: (recipeId: string) => void;
}) {
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(
      new FormData(event.currentTarget).get("name") ?? "",
    ).trim();
    if (name) createRecipe.mutate(name);
  }

  return (
    <section>
      <h2>Recipes</h2>
      {recipes.isError && <p role="alert">{recipes.error.message}</p>}
      <ul aria-label="Recipes">
        {recipes.data?.map((recipe) => (
          <li key={recipe.id}>
            <a
              href={`?view=recipe&recipe=${recipe.id}`}
              onClick={(event) => {
                event.preventDefault();
                onOpen(recipe.id);
              }}
            >
              {recipe.name}
            </a>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit}>
        <h3>New Recipe</h3>
        <label>
          Recipe name <input name="name" maxLength={200} required />
        </label>
        <button type="submit" disabled={createRecipe.isPending}>
          Create Recipe
        </button>
        {createRecipe.error && <p role="alert">{createRecipe.error.message}</p>}
      </form>
    </section>
  );
}
