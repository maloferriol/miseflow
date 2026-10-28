import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import type { CatalogIngredient, RecipeListItem } from "./api.ts";
import { LinkChoiceView, type LinkChoiceViewProps } from "./LinkChoice.tsx";

const butter: CatalogIngredient = {
  id: "butter-id",
  name: "butter",
  source: "seed",
  preferredKind: "mass",
  mainUnit: "g",
  shoppingCategory: { id: "dairy-id", name: "Dairy" },
  aliases: [],
  matchedBy: "name",
  exact: false,
  overridden: false,
  overrideId: null,
};

const stock: RecipeListItem = {
  id: "stock-id",
  name: "Chicken stock",
  servings: null,
  latestRevision: 1,
  yield: null,
};

const categories = [
  { id: "dairy-id", name: "Dairy" },
  { id: "other-id", name: "Other" },
];

// The link choice for "chicken stock{500%ml}", with nothing near, nothing pending and no error;
// each test sets what it checks.
function renderLinkChoice(props: Partial<LinkChoiceViewProps> = {}) {
  const view: LinkChoiceViewProps = {
    name: "chicken stock",
    amount: "500%ml",
    near: [],
    nearRecipes: [],
    onLinked: () => {},
    categories,
    aliasPending: false,
    ingredientPending: false,
    subRecipePending: false,
    aliasError: null,
    ingredientError: null,
    subRecipeError: null,
    onUseNearMatch: () => {},
    onCreateIngredient: () => {},
    onCreateSubRecipe: () => {},
    ...props,
  };
  return renderView(<LinkChoiceView {...view} />);
}

const button = (name: string) => screen.getByRole("button", { name });

describe("Link choice", () => {
  it("offers each near match, which hands that Ingredient back to teach the alias", () => {
    const onUseNearMatch = vi.fn();
    renderLinkChoice({ near: [butter], onUseNearMatch });
    expect(screen.getByRole("list", { name: "Near matches for chicken stock" })).toBeTruthy();

    fireEvent.click(button("Use butter"));
    expect(onUseNearMatch).toHaveBeenCalledWith(butter);
  });

  it("offers each matching Recipe, which links the name as that sub-recipe", () => {
    const onLinked = vi.fn();
    renderLinkChoice({ nearRecipes: [stock], onLinked });

    fireEvent.click(button("Use Recipe Chicken stock"));
    expect(onLinked).toHaveBeenCalledWith({ subRecipeId: "stock-id" });
  });

  it("offers no near matches or Recipes when there are none", () => {
    renderLinkChoice();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("creates the name as an Ingredient, with its kind of measure from the amount, under Other", () => {
    const onCreateIngredient = vi.fn();
    renderLinkChoice({ onCreateIngredient });
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Kind of measure" }).value).toBe(
      "volume",
    );

    fireEvent.click(button("Create Ingredient"));
    expect(onCreateIngredient).toHaveBeenCalledWith({
      name: "chicken stock",
      preferredKind: "volume",
      shoppingCategoryId: "other-id",
    });
  });

  it("creates the Ingredient with the name, kind and Shopping category the cook picks", () => {
    const onCreateIngredient = vi.fn();
    renderLinkChoice({ onCreateIngredient });
    fireEvent.change(screen.getByRole("textbox", { name: "New Ingredient name" }), {
      target: { value: "  stock  " },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Kind of measure" }), {
      target: { value: "mass" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Shopping category" }), {
      target: { value: "dairy-id" },
    });

    fireEvent.click(button("Create Ingredient"));
    expect(onCreateIngredient).toHaveBeenCalledWith({
      name: "stock",
      preferredKind: "mass",
      shoppingCategoryId: "dairy-id",
    });
  });

  it("keeps Create Ingredient off until the Shopping categories have loaded", () => {
    renderLinkChoice({ categories: undefined });
    expect(screen.queryByRole("combobox", { name: "Shopping category" })).toBeNull();
    expect(button("Create Ingredient").hasAttribute("disabled")).toBe(true);
  });

  it("creates the name as a sub-recipe, capitalised, or as the name the cook types", () => {
    const onCreateSubRecipe = vi.fn();
    renderLinkChoice({ onCreateSubRecipe });
    fireEvent.click(button("Create sub-recipe"));
    expect(onCreateSubRecipe).toHaveBeenLastCalledWith("Chicken stock");

    fireEvent.change(screen.getByRole("textbox", { name: "Name for the sub-recipe" }), {
      target: { value: " Brown stock " },
    });
    fireEvent.click(button("Create sub-recipe"));
    expect(onCreateSubRecipe).toHaveBeenLastCalledWith("Brown stock");
  });

  it("disables each choice while its own link is pending", () => {
    const view = renderLinkChoice({ near: [butter], aliasPending: true });
    expect(button("Use butter").hasAttribute("disabled")).toBe(true);
    expect(button("Create Ingredient").hasAttribute("disabled")).toBe(false);

    view.unmount();
    renderLinkChoice({ near: [butter], ingredientPending: true, subRecipePending: true });
    expect(button("Use butter").hasAttribute("disabled")).toBe(false);
    expect(button("Create Ingredient").hasAttribute("disabled")).toBe(true);
    expect(button("Create sub-recipe").hasAttribute("disabled")).toBe(true);
  });

  it("shows each failed link as an alert with its message", () => {
    renderLinkChoice({
      aliasError: new Error("Could not add the alias (500)"),
      ingredientError: new Error("Could not create the Ingredient (409)"),
      subRecipeError: new Error("Could not create the sub-recipe (500)"),
    });
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "Could not add the alias (500)",
      "Could not create the Ingredient (409)",
      "Could not create the sub-recipe (500)",
    ]);
  });
});
