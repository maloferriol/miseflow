import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../test/action.ts";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import {
  type CatalogIngredient,
  fetchShoppingCategories,
  mutate,
  type RecipeListItem,
} from "./api.ts";
import {
  LinkChoice,
  LinkChoiceView,
  type LinkChoiceViewProps,
  useLinkChoice,
} from "./LinkChoice.tsx";

// The network boundary only: the hook's queries and mutations run through a real QueryClient.
vi.mock("./api.ts", () => ({ fetchShoppingCategories: vi.fn(), mutate: vi.fn() }));

// Any made-up id: the hook makes ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

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
  { id: "dairy-id", name: "Dairy", position: "a0" },
  { id: "other-id", name: "Other", position: "a1" },
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
    alias: action(),
    ingredient: action(),
    subRecipe: action(),
    ...props,
  };
  return render(<LinkChoiceView {...view} />);
}

const button = (name: string) => screen.getByRole("button", { name });

describe("Link choice", () => {
  it("offers each near match, which hands that Ingredient back to teach the alias", () => {
    const onUseNearMatch = vi.fn();
    renderLinkChoice({ near: [butter], alias: action({ run: onUseNearMatch }) });
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
    renderLinkChoice({ ingredient: action({ run: onCreateIngredient }) });
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
    renderLinkChoice({ ingredient: action({ run: onCreateIngredient }) });
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
    renderLinkChoice({ subRecipe: action({ run: onCreateSubRecipe }) });
    fireEvent.click(button("Create sub-recipe"));
    expect(onCreateSubRecipe).toHaveBeenLastCalledWith("Chicken stock");

    fireEvent.change(screen.getByRole("textbox", { name: "Name for the sub-recipe" }), {
      target: { value: " Brown stock " },
    });
    fireEvent.click(button("Create sub-recipe"));
    expect(onCreateSubRecipe).toHaveBeenLastCalledWith("Brown stock");
  });

  it("disables each choice while its own link is pending", () => {
    const view = renderLinkChoice({ near: [butter], alias: action({ pending: true }) });
    expect(button("Use butter").hasAttribute("disabled")).toBe(true);
    expect(button("Create Ingredient").hasAttribute("disabled")).toBe(false);

    view.unmount();
    renderLinkChoice({
      near: [butter],
      ingredient: action({ pending: true }),
      subRecipe: action({ pending: true }),
    });
    expect(button("Use butter").hasAttribute("disabled")).toBe(false);
    expect(button("Create Ingredient").hasAttribute("disabled")).toBe(true);
    expect(button("Create sub-recipe").hasAttribute("disabled")).toBe(true);
  });

  it("shows each failed link as an alert with its message", () => {
    renderLinkChoice({
      alias: action({ error: new Error("Could not add the alias (500)") }),
      ingredient: action({ error: new Error("Could not create the Ingredient (409)") }),
      subRecipe: action({ error: new Error("Could not create the sub-recipe (500)") }),
    });
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "Could not add the alias (500)",
      "Could not create the Ingredient (409)",
      "Could not create the sub-recipe (500)",
    ]);
  });
});

describe("Link choice hook", () => {
  beforeEach(() => {
    vi.mocked(fetchShoppingCategories).mockReset().mockResolvedValue(categories);
    vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
  });

  // The mutation the hook sent, by name.
  const sent = (name: string) => vi.mocked(mutate).mock.calls.find((call) => call[0].name === name);

  it("returns the Shopping categories it fetched", async () => {
    const { result } = renderQueryHook(() => useLinkChoice("chicken stock", () => {}));
    await waitFor(() => expect(result.current.categories).toEqual(categories));
  });

  it("teaches a near match the name as its alias, then refetches Ingredients and links to it", async () => {
    const onLinked = vi.fn();
    const { result, client } = renderQueryHook(() => useLinkChoice("chicken stock", onLinked));
    client.setQueryData(["ingredients", "chicken"], [butter]);

    act(() => result.current.alias.run(butter));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith({ ingredientId: "butter-id" }));
    expect(sent("addAlias")?.[0].args).toEqual({
      aliasId: anId,
      ingredientId: "butter-id",
      name: "chicken stock",
    });
    expect(client.getQueryState(["ingredients", "chicken"])?.isInvalidated).toBe(true);
  });

  it("creates an Ingredient, then refetches Ingredients and links to the new one", async () => {
    const onLinked = vi.fn();
    const { result, client } = renderQueryHook(() => useLinkChoice("chicken stock", onLinked));
    client.setQueryData(["ingredients", "chicken"], []);

    act(() =>
      result.current.ingredient.run({
        name: "chicken stock",
        preferredKind: "volume",
        shoppingCategoryId: "other-id",
      }),
    );
    await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    const args = sent("createIngredient")?.[0].args;
    expect(args).toEqual({
      ingredientId: anId,
      name: "chicken stock",
      preferredKind: "volume",
      shoppingCategoryId: "other-id",
    });
    expect(onLinked).toHaveBeenCalledWith({ ingredientId: args?.ingredientId });
    expect(client.getQueryState(["ingredients", "chicken"])?.isInvalidated).toBe(true);
  });

  it("creates a sub-recipe, then refetches the Recipes and links to the new one", async () => {
    const onLinked = vi.fn();
    const { result, client } = renderQueryHook(() => useLinkChoice("chicken stock", onLinked));
    client.setQueryData(["recipes"], [stock]);

    act(() => result.current.subRecipe.run("Chicken stock"));
    await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    const args = sent("createSubRecipe")?.[0].args;
    expect(args).toEqual({
      recipeId: anId,
      revisionId: anId,
      name: "Chicken stock",
    });
    expect(onLinked).toHaveBeenCalledWith({ subRecipeId: args?.recipeId });
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true);
  });

  type Choice = ReturnType<typeof useLinkChoice>;
  it.each<[string, (c: Choice) => void, "alias" | "ingredient" | "subRecipe"]>([
    ["near match", (c) => c.alias.run(butter), "alias"],
    [
      "new Ingredient",
      (c) => c.ingredient.run({ name: "stock", preferredKind: "volume", shoppingCategoryId: "x" }),
      "ingredient",
    ],
    ["new sub-recipe", (c) => c.subRecipe.run("Stock"), "subRecipe"],
  ])("returns a %s as pending while it sends, then its error", async (_, choose, choice) => {
    let fail: (error: Error) => void = () => {};
    vi.mocked(mutate).mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const onLinked = vi.fn();
    const { result } = renderQueryHook(() => useLinkChoice("chicken stock", onLinked));

    act(() => choose(result.current));
    await waitFor(() => expect(result.current[choice].pending).toBe(true));
    act(() => fail(new Error("Could not link (500)")));
    await waitFor(() =>
      expect(result.current[choice].error).toEqual(new Error("Could not link (500)")),
    );
    expect(result.current[choice].pending).toBe(false);
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("wires the view to the hook: Create Ingredient sends it and links the name", async () => {
    const onLinked = vi.fn();
    renderWired(
      <LinkChoice
        name="chicken stock"
        amount="500%ml"
        near={[]}
        nearRecipes={[]}
        onLinked={onLinked}
      />,
    );
    await screen.findByRole("combobox", { name: "Shopping category" });

    fireEvent.click(button("Create Ingredient"));
    await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    expect(sent("createIngredient")?.[0].args).toMatchObject({
      name: "chicken stock",
      preferredKind: "volume",
      shoppingCategoryId: "other-id",
    });
  });
});
