// The Ingredient catalog (ADR 0011): each part's hook, and the part that renders its view with it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type CatalogIngredient,
  fetchIngredients,
  fetchShoppingCategories,
  mutate,
} from "./api.ts";
import type { NewIngredientInput } from "./catalog-screen.ts";
import { CatalogView, IngredientView, NewIngredientView } from "./CatalogViews.tsx";

/** The search box's text and the Ingredients it finds. Only state and query hooks: no branches. */
export function useCatalog() {
  const [query, setQuery] = useState("");
  const results = useQuery({
    queryKey: ["ingredients", query],
    queryFn: () => fetchIngredients(query),
  });
  return { query, onQueryChange: setQuery, results };
}

export function CatalogScreen() {
  const catalog = useCatalog();
  return (
    <CatalogView
      {...catalog}
      renderIngredient={(ingredient) => <IngredientItem ingredient={ingredient} />}
      renderNewIngredient={() => <NewIngredient onCreated={catalog.onQueryChange} />}
    />
  );
}

/** Teaches one Ingredient an alias. Only query-client and mutation hooks: no branches. */
export function useAddAlias(ingredientId: string) {
  const queryClient = useQueryClient();
  const addAlias = useMutation({
    mutationFn: async (name: string) =>
      mutate(crypto.randomUUID(), "addAlias", {
        aliasId: crypto.randomUUID(),
        ingredientId,
        name,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ingredients"] }),
  });
  return {
    addAliasPending: addAlias.isPending,
    addAliasError: addAlias.error,
    onAddAlias: (name: string, onAdded: () => void) =>
      addAlias.mutate(name, { onSuccess: onAdded }),
  };
}

function IngredientItem({ ingredient }: Readonly<{ ingredient: CatalogIngredient }>) {
  return <IngredientView {...useAddAlias(ingredient.id)} ingredient={ingredient} />;
}

/**
 * Creates an Ingredient, then searches for it by its name. Only query, query-client and mutation
 * hooks: no branches.
 */
export function useNewIngredient(onCreated: (name: string) => void) {
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ["shopping-categories"],
    queryFn: fetchShoppingCategories,
  });
  const createIngredient = useMutation({
    mutationFn: async (args: NewIngredientInput) =>
      mutate(crypto.randomUUID(), "createIngredient", {
        ingredientId: crypto.randomUUID(),
        ...args,
      }),
    onSuccess: async (_, { name }) => {
      await queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      onCreated(name);
    },
  });
  return {
    categories,
    createPending: createIngredient.isPending,
    createError: createIngredient.error,
    onCreate: (input: NewIngredientInput, onSaved: () => void) =>
      createIngredient.mutate(input, { onSuccess: onSaved }),
  };
}

function NewIngredient({ onCreated }: Readonly<{ onCreated: (name: string) => void }>) {
  return <NewIngredientView {...useNewIngredient(onCreated)} />;
}
