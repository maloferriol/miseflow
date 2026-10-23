import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  type CatalogIngredient,
  fetchIngredients,
  fetchShoppingCategories,
  mutate,
} from "./api.ts";

// The Ingredient catalog: search the seed and the kitchen's own Ingredients by name or alias,
// create an Ingredient, and teach any Ingredient a new alias.
export function CatalogScreen() {
  const [query, setQuery] = useState("");
  const results = useQuery({
    queryKey: ["ingredients", query],
    queryFn: () => fetchIngredients(query),
  });

  return (
    <section>
      <h2>Ingredient catalog</h2>
      <label>
        Search ingredients{" "}
        <input
          type="search"
          maxLength={200}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {results.isError && <p role="alert">{results.error.message}</p>}
      <ul aria-label="Ingredients">
        {results.data?.map((ingredient) => (
          <IngredientItem key={ingredient.id} ingredient={ingredient} />
        ))}
      </ul>
      <NewIngredient onCreated={setQuery} />
      <p>
        <small>
          Ingredient seed: Open Food Facts contributors and USDA FoodData
          Central, ODbL
        </small>
      </p>
    </section>
  );
}

function IngredientItem({ ingredient }: { ingredient: CatalogIngredient }) {
  const queryClient = useQueryClient();
  const addAlias = useMutation({
    mutationFn: async (name: string) =>
      mutate(crypto.randomUUID(), "addAlias", {
        aliasId: crypto.randomUUID(),
        ingredientId: ingredient.id,
        name,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["ingredients"] }),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("alias") ?? "").trim();
    if (name) addAlias.mutate(name, { onSuccess: () => form.reset() });
  }

  return (
    <li>
      <strong>{ingredient.name}</strong> ·{" "}
      {ingredient.shoppingCategory?.name ?? "No category"} ·{" "}
      {ingredient.mainUnit ?? `kitchen ${ingredient.preferredKind ?? ""} unit`}
      {ingredient.source === "own" && " · yours"}
      {ingredient.aliases.length > 0 && (
        <> · also: {ingredient.aliases.join(", ")}</>
      )}
      <form onSubmit={onSubmit}>
        <label>
          Alias <input name="alias" required />
        </label>
        <button type="submit" disabled={addAlias.isPending}>
          Add alias
        </button>
        {addAlias.error && <p role="alert">{addAlias.error.message}</p>}
      </form>
    </li>
  );
}

function NewIngredient({ onCreated }: { onCreated: (name: string) => void }) {
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ["shopping-categories"],
    queryFn: fetchShoppingCategories,
  });
  const createIngredient = useMutation({
    mutationFn: async (args: {
      name: string;
      preferredKind: string;
      shoppingCategoryId: string;
    }) =>
      mutate(crypto.randomUUID(), "createIngredient", {
        ingredientId: crypto.randomUUID(),
        ...args,
      }),
    onSuccess: async (_, { name }) => {
      await queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      onCreated(name);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    createIngredient.mutate(
      {
        name,
        preferredKind: String(data.get("preferredKind")),
        shoppingCategoryId: String(data.get("shoppingCategoryId")),
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <h3>New Ingredient</h3>
      <label>
        Ingredient name <input name="name" required />
      </label>
      <label>
        Kind of measure{" "}
        <select name="preferredKind" defaultValue="mass">
          <option value="mass">mass</option>
          <option value="volume">volume</option>
          <option value="count">count</option>
        </select>
      </label>
      <label>
        Shopping category{" "}
        <select name="shoppingCategoryId" required>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={createIngredient.isPending || !categories.data}
      >
        Create Ingredient
      </button>
      {categories.error && <p role="alert">{categories.error.message}</p>}
      {createIngredient.error && (
        <p role="alert">{createIngredient.error.message}</p>
      )}
    </form>
  );
}
