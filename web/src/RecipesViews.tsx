// The Recipes list's view (ADR 0011): props only, so its tests render it without the API.
import type { SubmitEvent } from "react";
import type { RecipeListItem } from "./api.ts";
import { fieldText, trimmedOrNull } from "./form-fields.ts";

/** A query as the view reads it: its data once loaded, and its error once failed. */
export type ListQuery<T> = { data: T | undefined; error: Error | null };

export type RecipesViewProps = {
  recipes: ListQuery<Pick<RecipeListItem, "id" | "name">[]>;
  createPending: boolean;
  createError: Error | null;
  onCreate: (name: string) => void;
  onOpen: (recipeId: string) => void;
};

/** The kitchen's Recipes, by name, and a "New Recipe" form (#83 Decision 8). */
export function RecipesView({
  recipes,
  createPending,
  createError,
  onCreate,
  onOpen,
}: Readonly<RecipesViewProps>) {
  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = trimmedOrNull(fieldText(new FormData(event.currentTarget), "name"));
    if (name) onCreate(name);
  }

  return (
    <section>
      <h2>Recipes</h2>
      {recipes.error && <p role="alert">{recipes.error.message}</p>}
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
        <button type="submit" disabled={createPending}>
          Create Recipe
        </button>
        {createError && <p role="alert">{createError.message}</p>}
      </form>
    </section>
  );
}
