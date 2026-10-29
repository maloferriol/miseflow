// The Ingredient catalog's views (ADR 0011): props only, so their tests render them without the API.
import { type FormEvent, Fragment, type ReactNode } from "react";
import type { CatalogIngredient, fetchShoppingCategories } from "./api.ts";
import {
  ingredientDetails,
  type NewIngredientInput,
  newIngredientInput,
} from "./catalog-screen.ts";
import { fieldText, trimmedOrNull } from "./form-fields.ts";
import type { ListQuery } from "./RecipesViews.tsx";

export type CatalogViewProps = {
  /** What the cook typed in the search box. */
  query: string;
  onQueryChange: (query: string) => void;
  results: ListQuery<CatalogIngredient[]>;
  /** One Ingredient in the results, with its alias form. */
  renderIngredient: (ingredient: CatalogIngredient) => ReactNode;
  /** The New Ingredient form. */
  renderNewIngredient: () => ReactNode;
};

/**
 * The Ingredient catalog: search the seed and the kitchen's own Ingredients by name or alias,
 * create an Ingredient, and teach any Ingredient a new alias.
 */
export function CatalogView({
  query,
  onQueryChange,
  results,
  renderIngredient,
  renderNewIngredient,
}: Readonly<CatalogViewProps>) {
  return (
    <section>
      <h2>Ingredient catalog</h2>
      <label>
        Search ingredients{" "}
        <input
          type="search"
          maxLength={200}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </label>
      {results.error && <p role="alert">{results.error.message}</p>}
      <ul aria-label="Ingredients">
        {results.data?.map((ingredient) => (
          <Fragment key={ingredient.id}>{renderIngredient(ingredient)}</Fragment>
        ))}
      </ul>
      {renderNewIngredient()}
      <p>
        <small>Ingredient seed: Open Food Facts contributors and USDA FoodData Central, ODbL</small>
      </p>
    </section>
  );
}

export type IngredientViewProps = {
  ingredient: CatalogIngredient;
  addAliasPending: boolean;
  addAliasError: Error | null;
  /** Adds the alias; `onAdded` runs once it is saved. */
  onAddAlias: (name: string, onAdded: () => void) => void;
};

/** One Ingredient: its name and details, and a form to teach it an alias. */
export function IngredientView({
  ingredient,
  addAliasPending,
  addAliasError,
  onAddAlias,
}: Readonly<IngredientViewProps>) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = trimmedOrNull(fieldText(new FormData(form), "alias"));
    if (name) onAddAlias(name, () => form.reset());
  }

  return (
    <li>
      <strong>{ingredient.name}</strong> · {ingredientDetails(ingredient)}
      <form onSubmit={onSubmit}>
        <label>
          Alias <input name="alias" required />
        </label>
        <button type="submit" disabled={addAliasPending}>
          Add alias
        </button>
        {addAliasError && <p role="alert">{addAliasError.message}</p>}
      </form>
    </li>
  );
}

export type ShoppingCategory = Awaited<ReturnType<typeof fetchShoppingCategories>>[number];

export type NewIngredientViewProps = {
  categories: ListQuery<ShoppingCategory[]>;
  createPending: boolean;
  createError: Error | null;
  /** Creates the Ingredient; `onCreated` runs once it is saved. */
  onCreate: (input: NewIngredientInput, onCreated: () => void) => void;
};

/** The New Ingredient form: its name, kind of measure and Shopping category. */
export function NewIngredientView({
  categories,
  createPending,
  createError,
  onCreate,
}: Readonly<NewIngredientViewProps>) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = newIngredientInput(
      String(data.get("name") ?? ""),
      String(data.get("preferredKind")),
      String(data.get("shoppingCategoryId")),
    );
    if (input) onCreate(input, () => form.reset());
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
      <button type="submit" disabled={createPending || !categories.data}>
        Create Ingredient
      </button>
      {categories.error && <p role="alert">{categories.error.message}</p>}
      {createError && <p role="alert">{createError.message}</p>}
    </form>
  );
}
