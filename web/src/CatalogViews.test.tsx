import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import type { CatalogIngredient } from "./api.ts";
import { ingredientDetails } from "./catalog-screen.ts";
import {
  CatalogView,
  type CatalogViewProps,
  IngredientView,
  type IngredientViewProps,
  NewIngredientView,
  type NewIngredientViewProps,
} from "./CatalogViews.tsx";

const vegetables = { id: "cat-veg", name: "Vegetables", position: "a0" };
const meat = { id: "cat-meat", name: "Meat", position: "a1" };

// A seed Ingredient from ADR 0004's velouté, with an alias.
const onion: CatalogIngredient = {
  id: "i-onion",
  name: "onion",
  source: "seed",
  preferredKind: "mass",
  mainUnit: "g",
  shoppingCategory: { id: vegetables.id, name: vegetables.name },
  aliases: ["oignon"],
  matchedBy: "name",
  exact: false,
  overridden: false,
  overrideId: null,
};
const leek: CatalogIngredient = { ...onion, id: "i-leek", name: "leek", aliases: [] };

describe("Catalog view", () => {
  function catalogView(props: Partial<CatalogViewProps> = {}) {
    return (
      <CatalogView
        query=""
        onQueryChange={vi.fn()}
        results={{ data: [onion, leek], error: null }}
        renderIngredient={(ingredient) => <li>{ingredient.name}</li>}
        renderNewIngredient={() => <p>New Ingredient form</p>}
        {...props}
      />
    );
  }
  const list = () => screen.getByRole("list", { name: "Ingredients" });
  const search = () => screen.getByRole("searchbox", { name: "Search ingredients" });

  it("lists each Ingredient found, then the New Ingredient form and the seed's licence", () => {
    renderView(catalogView());
    const items = within(list()).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["onion", "leek"]);
    expect(screen.getByText("New Ingredient form")).toBeTruthy();
    expect(
      screen.getByText(
        "Ingredient seed: Open Food Facts contributors and USDA FoodData Central, ODbL",
      ),
    ).toBeTruthy();
  });

  it("shows what the cook searched for, and hands each change back", () => {
    const onQueryChange = vi.fn();
    renderView(catalogView({ query: "oni", onQueryChange }));
    expect(search()).toHaveProperty("value", "oni");
    fireEvent.change(search(), { target: { value: "onio" } });
    expect(onQueryChange).toHaveBeenCalledWith("onio");
  });

  it("shows an empty list while the search loads, and when it finds nothing", () => {
    const view = renderView(catalogView({ results: { data: undefined, error: null } }));
    expect(within(list()).queryAllByRole("listitem")).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();

    view.rerender(catalogView({ results: { data: [], error: null } }));
    expect(within(list()).queryAllByRole("listitem")).toEqual([]);
  });

  it("shows why the search failed", () => {
    const error = new Error("Could not search the Ingredients (500)");
    renderView(catalogView({ results: { data: undefined, error } }));
    expect(screen.getByRole("alert").textContent).toBe("Could not search the Ingredients (500)");
  });
});

describe("Ingredient view", () => {
  function ingredientView(props: Partial<IngredientViewProps> = {}) {
    return (
      <ul>
        <IngredientView
          ingredient={onion}
          addAliasPending={false}
          addAliasError={null}
          onAddAlias={vi.fn()}
          {...props}
        />
      </ul>
    );
  }
  const aliasField = () => screen.getByRole("textbox", { name: "Alias" });
  const addAlias = () => screen.getByRole("button", { name: "Add alias" });

  it("shows the Ingredient's name, then its details", () => {
    renderView(ingredientView());
    expect(screen.getByText("onion").tagName).toBe("STRONG");
    expect(screen.getByRole("listitem").textContent).toMatch(
      new RegExp(`^onion · ${ingredientDetails(onion)}Alias`),
    );
  });

  it("adds the trimmed alias the cook typed, and clears the field once it is saved", () => {
    const onAddAlias = vi.fn();
    renderView(ingredientView({ onAddAlias }));
    fireEvent.change(aliasField(), { target: { value: " brown onion " } });
    fireEvent.click(addAlias());
    expect(onAddAlias).toHaveBeenCalledExactlyOnceWith("brown onion", expect.any(Function));
    expect(aliasField()).toHaveProperty("value", " brown onion ");

    const [[, onAdded]] = onAddAlias.mock.calls as [[string, () => void]];
    onAdded();
    expect(aliasField()).toHaveProperty("value", "");
  });

  it("adds nothing for a blank alias", () => {
    const onAddAlias = vi.fn();
    renderView(ingredientView({ onAddAlias }));
    fireEvent.change(aliasField(), { target: { value: "  " } });
    fireEvent.submit(addAlias().closest("form")!);
    expect(onAddAlias).not.toHaveBeenCalled();
  });

  it("disables Add alias while an add is pending, and shows why one failed", () => {
    const view = renderView(ingredientView({ addAliasPending: true }));
    expect(addAlias()).toHaveProperty("disabled", true);

    view.rerender(ingredientView({ addAliasError: new Error("Could not save (500)") }));
    expect(addAlias()).toHaveProperty("disabled", false);
    expect(screen.getByRole("alert").textContent).toBe("Could not save (500)");
  });
});

describe("New Ingredient view", () => {
  function newIngredientView(props: Partial<NewIngredientViewProps> = {}) {
    return (
      <NewIngredientView
        categories={{ data: [vegetables, meat], error: null }}
        createPending={false}
        createError={null}
        onCreate={vi.fn()}
        {...props}
      />
    );
  }
  const nameField = () => screen.getByRole("textbox", { name: "Ingredient name" });
  const kind = () => screen.getByRole("combobox", { name: "Kind of measure" });
  const category = () => screen.getByRole("combobox", { name: "Shopping category" });
  const create = () => screen.getByRole("button", { name: "Create Ingredient" });

  it("offers each Shopping category, and starts on mass and the first category", () => {
    renderView(newIngredientView());
    const options = within(category()).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Vegetables", "Meat"]);
    expect(kind()).toHaveProperty("value", "mass");
    expect(category()).toHaveProperty("value", "cat-veg");
  });

  it("creates the Ingredient with the trimmed name, the kind and the category chosen", () => {
    const onCreate = vi.fn();
    renderView(newIngredientView({ onCreate }));
    fireEvent.change(nameField(), { target: { value: " chicken wings " } });
    fireEvent.change(kind(), { target: { value: "count" } });
    fireEvent.change(category(), { target: { value: "cat-meat" } });
    fireEvent.click(create());
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(
      { name: "chicken wings", preferredKind: "count", shoppingCategoryId: "cat-meat" },
      expect.any(Function),
    );
  });

  it("clears the form once the Ingredient is saved", () => {
    const onCreate = vi.fn();
    renderView(newIngredientView({ onCreate }));
    fireEvent.change(nameField(), { target: { value: "chicken wings" } });
    fireEvent.change(kind(), { target: { value: "count" } });
    fireEvent.click(create());

    const [[, onCreated]] = onCreate.mock.calls as [[unknown, () => void]];
    onCreated();
    expect(nameField()).toHaveProperty("value", "");
    expect(kind()).toHaveProperty("value", "mass");
  });

  it("creates nothing for a blank name", () => {
    const onCreate = vi.fn();
    renderView(newIngredientView({ onCreate }));
    fireEvent.change(nameField(), { target: { value: "   " } });
    fireEvent.submit(create().closest("form")!);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("disables Create until the Shopping categories load, and shows why they didn't", () => {
    const view = renderView(newIngredientView({ categories: { data: undefined, error: null } }));
    expect(create()).toHaveProperty("disabled", true);
    expect(within(category()).queryAllByRole("option")).toEqual([]);

    const error = new Error("Could not load the Shopping categories (500)");
    view.rerender(newIngredientView({ categories: { data: undefined, error } }));
    expect(create()).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not load the Shopping categories (500)",
    );
  });

  it("disables Create while a create is pending, and shows why one failed", () => {
    const view = renderView(newIngredientView({ createPending: true }));
    expect(create()).toHaveProperty("disabled", true);

    view.rerender(newIngredientView({ createError: new Error("Could not save (500)") }));
    expect(create()).toHaveProperty("disabled", false);
    expect(screen.getByRole("alert").textContent).toBe("Could not save (500)");
  });
});
