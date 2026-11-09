import type { Kind } from "@miseflow/shared/src/catalog/units.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Action, toAction } from "./action.ts";
import {
  type CatalogIngredient,
  fetchShoppingCategories,
  mutate,
  type RecipeListItem,
} from "./api.ts";
import {
  defaultShoppingCategory,
  newIngredientKind,
  newIngredientName,
  newSubRecipeName,
  subRecipeName,
} from "./step-editor.ts";
import { linkChoices, type Target } from "./step-links.ts";

type LinkChoiceProps = {
  name: string;
  /** The ref's braced amount, as the cook typed it. */
  amount: string;
  near: CatalogIngredient[];
  nearRecipes: RecipeListItem[];
  onLinked: (target: Target) => void;
};

type NewIngredient = { name: string; preferredKind: Kind; shoppingCategoryId: string };

export type LinkChoiceViewProps = LinkChoiceProps & {
  categories: { id: string; name: string }[] | undefined;
  /** Use a near match: teaches the name as its alias. */
  alias: Action<CatalogIngredient>;
  ingredient: Action<NewIngredient>;
  /** Create a sub-recipe with this name. */
  subRecipe: Action<string>;
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
  // Refetches what the link added to, then links the name to its target.
  const linked = async (queryKey: string[], target: Target) => {
    await queryClient.invalidateQueries({ queryKey });
    onLinked(target);
  };
  const addAlias = useMutation({
    mutationFn: choices.useNearMatch,
    onSuccess: (target) => linked(["ingredients"], target),
  });
  const createIngredient = useMutation({
    mutationFn: choices.createIngredient,
    onSuccess: (target) => linked(["ingredients"], target),
  });
  const createSubRecipe = useMutation({
    mutationFn: choices.createSubRecipe,
    onSuccess: (target) => linked(["recipes"], target),
  });
  return {
    categories: categories.data,
    alias: toAction<CatalogIngredient>(addAlias),
    ingredient: toAction<NewIngredient>(createIngredient),
    subRecipe: toAction<string>(createSubRecipe),
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
  alias,
  ingredient,
  subRecipe,
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
          {near.map((match) => (
            <li key={match.id}>
              <button type="button" disabled={alias.pending} onClick={() => alias.run(match)}>
                Use {match.name}
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
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
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
        disabled={ingredient.pending || !chosenCategory}
        onClick={() =>
          ingredient.run({
            name: newIngredientName(newName, name),
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
        disabled={subRecipe.pending}
        onClick={() => subRecipe.run(newSubRecipeName(recipeName, name))}
      >
        Create sub-recipe
      </button>
      {alias.error && <p role="alert">{alias.error.message}</p>}
      {ingredient.error && <p role="alert">{ingredient.error.message}</p>}
      {subRecipe.error && <p role="alert">{subRecipe.error.message}</p>}
    </fieldset>
  );
}

/** One unmatched name's link choice, inside the Step form. */
export function LinkChoice(props: Readonly<LinkChoiceProps>) {
  const choice = useLinkChoice(props.name, props.onLinked);
  return <LinkChoiceView {...props} {...choice} />;
}
