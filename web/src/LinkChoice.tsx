import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type CatalogIngredient,
  fetchShoppingCategories,
  mutate,
  type RecipeListItem,
} from "./api.ts";
import { defaultShoppingCategory, newIngredientKind, subRecipeName } from "./step-editor.ts";
import { linkChoices, type Target } from "./step-links.ts";

type LinkChoiceProps = {
  name: string;
  /** The ref's braced amount, as the cook typed it. */
  amount: string;
  near: CatalogIngredient[];
  nearRecipes: RecipeListItem[];
  onLinked: (target: Target) => void;
};

type NewIngredient = { name: string; preferredKind: string; shoppingCategoryId: string };

export type LinkChoiceViewProps = LinkChoiceProps & {
  categories: { id: string; name: string }[] | undefined;
  aliasPending: boolean;
  ingredientPending: boolean;
  subRecipePending: boolean;
  aliasError: Error | null;
  ingredientError: Error | null;
  subRecipeError: Error | null;
  onUseNearMatch: (ingredient: CatalogIngredient) => void;
  onCreateIngredient: (ingredient: NewIngredient) => void;
  onCreateSubRecipe: (name: string) => void;
};

/** The Shopping categories and the three link mutations. No branches. */
export function useLinkChoice(name: string, onLinked: (target: Target) => void) {
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ["shopping-categories"],
    queryFn: fetchShoppingCategories,
  });
  // Each action replays on a retry after a lost response, with its own ids (#127 D).
  const [choices] = useState(() => linkChoices(name, mutate));
  const addAlias = useMutation({
    mutationFn: choices.useNearMatch,
    onSuccess: async (target) => {
      await queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      onLinked(target);
    },
  });
  const createIngredient = useMutation({
    mutationFn: choices.createIngredient,
    onSuccess: async (target) => {
      await queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      onLinked(target);
    },
  });
  const createSubRecipe = useMutation({
    mutationFn: choices.createSubRecipe,
    onSuccess: async (target) => {
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      onLinked(target);
    },
  });
  return {
    categories: categories.data,
    aliasPending: addAlias.isPending,
    ingredientPending: createIngredient.isPending,
    subRecipePending: createSubRecipe.isPending,
    aliasError: addAlias.error,
    ingredientError: createIngredient.error,
    subRecipeError: createSubRecipe.error,
    onUseNearMatch: (ingredient: CatalogIngredient) => addAlias.mutate(ingredient),
    onCreateIngredient: (ingredient: NewIngredient) => createIngredient.mutate(ingredient),
    onCreateSubRecipe: (recipeName: string) => createSubRecipe.mutate(recipeName),
  };
}

// "Link 'X'": pick a near match, which teaches X as its alias, use one of the kitchen's Recipes,
// or create X as an Ingredient or as a sub-recipe. Each is its own mutation, sent before the Step
// save (Decision 5, #84 Q1).
export function LinkChoiceView({
  name,
  amount,
  near,
  nearRecipes,
  onLinked,
  categories,
  aliasPending,
  ingredientPending,
  subRecipePending,
  aliasError,
  ingredientError,
  subRecipeError,
  onUseNearMatch,
  onCreateIngredient,
  onCreateSubRecipe,
}: LinkChoiceViewProps) {
  // What the cook types, set from the name on open. Inside the Step's form, so these are plain
  // fields rather than a nested <form>.
  const [newName, setNewName] = useState(name);
  const [recipeName, setRecipeName] = useState(() => subRecipeName(name));
  const [kind, setKind] = useState(() => newIngredientKind(amount));
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const chosenCategory = categoryId ?? defaultShoppingCategory(categories);

  return (
    <fieldset>
      <legend>Link ‘{name}’</legend>
      {near.length > 0 && (
        <ul aria-label={`Near matches for ${name}`}>
          {near.map((ingredient) => (
            <li key={ingredient.id}>
              <button
                type="button"
                disabled={aliasPending}
                onClick={() => onUseNearMatch(ingredient)}
              >
                Use {ingredient.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {nearRecipes.length > 0 && (
        <ul aria-label={`Recipes matching ${name}`}>
          {nearRecipes.map((recipe) => (
            <li key={recipe.id}>
              <button type="button" onClick={() => onLinked({ subRecipeId: recipe.id })}>
                Use Recipe {recipe.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        New Ingredient name{" "}
        <input value={newName} maxLength={200} onChange={(e) => setNewName(e.target.value)} />
      </label>
      <label>
        Kind of measure{" "}
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="mass">mass</option>
          <option value="volume">volume</option>
          <option value="count">count</option>
        </select>
      </label>
      {categories && (
        <label>
          Shopping category{" "}
          <select value={chosenCategory} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={ingredientPending || !chosenCategory}
        onClick={() =>
          onCreateIngredient({
            name: newName.trim() || name,
            preferredKind: kind,
            shoppingCategoryId: chosenCategory!,
          })
        }
      >
        Create Ingredient
      </button>
      <label>
        Name for the sub-recipe{" "}
        <input value={recipeName} maxLength={200} onChange={(e) => setRecipeName(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={subRecipePending}
        onClick={() => onCreateSubRecipe(recipeName.trim() || subRecipeName(name))}
      >
        Create sub-recipe
      </button>
      {aliasError && <p role="alert">{aliasError.message}</p>}
      {ingredientError && <p role="alert">{ingredientError.message}</p>}
      {subRecipeError && <p role="alert">{subRecipeError.message}</p>}
    </fieldset>
  );
}

/** One unmatched name's link choice, inside the Step form. */
export function LinkChoice(props: LinkChoiceProps) {
  const choice = useLinkChoice(props.name, props.onLinked);
  return <LinkChoiceView {...props} {...choice} />;
}
