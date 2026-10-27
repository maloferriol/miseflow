import { searchCatalog } from "@miseflow/shared/src/catalog/match.ts";
import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import {
  type CatalogIngredient,
  fetchIngredients,
  fetchRecipes,
  type RecipeListItem,
} from "./api.ts";

type Option =
  | { kind: "ingredient"; ingredient: CatalogIngredient }
  | { kind: "recipe"; recipe: RecipeListItem };

// A one-line combobox over the Ingredient catalog and the kitchen's Recipes (#84 Q4), opened when
// the cook types "@" in a Step. WAI-ARIA APG combobox with a listbox popup whose options sit in
// two groups: DOM focus stays on the input, the active option is named by aria-activedescendant;
// Down/Up move, Enter picks, Escape closes (keeping what was typed as Step text).
// Source: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
// Source: https://www.w3.org/WAI/ARIA/apg/patterns/listbox/ (grouped options)
export function IngredientPicker({
  recipeId,
  onPick,
  onPickRecipe,
  onClose,
}: {
  /** The Recipe being edited, which can't be its own sub-recipe. */
  recipeId: string;
  onPick: (ingredient: CatalogIngredient) => void;
  onPickRecipe: (recipe: RecipeListItem) => void;
  /** Closed without a pick: `typed` goes back into the Step text after the "@". */
  onClose: (typed: string) => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const results = useQuery({
    queryKey: ["ingredients", query],
    queryFn: () => fetchIngredients(query),
  });
  // The Recipe list is small and already cached for the Recipes screen, so it's searched here.
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: fetchRecipes });
  const recipeMatches = searchCatalog(
    (recipes.data ?? [])
      .filter((r) => r.id !== recipeId)
      .map((r) => ({ ...r, source: "own" as const, aliases: [] })),
    query,
    5,
  ).map((r) => r.entry);
  const options: Option[] = [
    ...(results.data ?? []).map((ingredient) => ({ kind: "ingredient" as const, ingredient })),
    ...recipeMatches.map((recipe) => ({ kind: "recipe" as const, recipe })),
  ];
  const expanded = options.length > 0;

  useEffect(() => input.current?.focus(), []);

  function pick(option: Option) {
    if (option.kind === "ingredient") onPick(option.ingredient);
    else onPickRecipe(option.recipe);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && expanded) {
      event.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp" && expanded) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = options[active] ?? options[0];
      if (picked) pick(picked);
    } else if (event.key === "Escape" || event.key === "{") {
      // "{" means the cook is typing the shorthand by hand: hand it back to the textarea.
      event.preventDefault();
      onClose(event.key === "{" ? `${query}{` : query);
    }
  }

  const optionProps = (index: number) => ({
    id: `${listId}-${index}`,
    role: "option",
    "aria-selected": index === active,
    // Keep focus on the input while picking with the mouse.
    onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(),
    onClick: () => pick(options[index]),
  });
  const ingredientCount = results.data?.length ?? 0;

  return (
    <div>
      <label>
        Ingredient or Recipe{" "}
        <input
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={active >= 0 && options[active] ? `${listId}-${active}` : undefined}
          maxLength={200}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {expanded && (
        <div role="listbox" id={listId} aria-label="Ingredient and Recipe matches">
          {ingredientCount > 0 && (
            <ul role="group" aria-label="Ingredients">
              {results.data!.map((option, index) => (
                <li key={option.id} {...optionProps(index)}>
                  {option.name}
                  {option.matchedBy === "alias" && " (alias)"}
                </li>
              ))}
            </ul>
          )}
          {recipeMatches.length > 0 && (
            <ul role="group" aria-label="Recipes">
              {recipeMatches.map((recipe, index) => (
                <li key={recipe.id} {...optionProps(ingredientCount + index)}>
                  {recipe.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {results.isError && <p role="alert">{results.error.message}</p>}
    </div>
  );
}
