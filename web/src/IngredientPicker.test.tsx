import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWired } from "../test/render-view.tsx";
import {
  type CatalogIngredient,
  fetchIngredients,
  fetchRecipes,
  type RecipeListItem,
} from "./api.ts";
import { IngredientPicker } from "./IngredientPicker.tsx";

// The network boundary only: the picker's queries run through a real QueryClient.
vi.mock("./api.ts", () => ({ fetchIngredients: vi.fn(), fetchRecipes: vi.fn() }));

// Seed Ingredients from ADR 0004's velouté; the shallot is found by its alias.
const ingredient = (id: string, name: string, matchedBy: "name" | "alias"): CatalogIngredient => ({
  id,
  name,
  source: "seed",
  preferredKind: "mass",
  mainUnit: "g",
  shoppingCategory: null,
  aliases: [],
  matchedBy,
  exact: false,
  overridden: false,
  overrideId: null,
});
const onion = ingredient("i-onion", "onion", "name");
const shallot = ingredient("i-shallot", "shallot", "alias");

// ADR 0004's Recipes. The velouté is the one being edited.
const recipe = (id: string, name: string): RecipeListItem => ({
  id,
  name,
  servings: null,
  yield: null,
  latestRevision: 1,
});
const stock = recipe("r-stock", "Chicken stock");
const velouté = recipe("r-veloute", "Velouté");
const beurreBlanc = recipe("r-beurre-blanc", "Beurre blanc");
// A picked Recipe as the picker hands it over: searched as one of the kitchen's own entries.
const pickedStock = { ...stock, source: "own", aliases: [] };

beforeEach(() => {
  vi.mocked(fetchIngredients)
    .mockReset()
    // Faked by query: nothing before the cook types or for "zzz", else the onion and the shallot.
    .mockImplementation((q) => Promise.resolve(q === "" || q === "zzz" ? [] : [onion, shallot]));
  vi.mocked(fetchRecipes).mockReset().mockResolvedValue([stock, velouté, beurreBlanc]);
});

function renderPicker() {
  const props = { onPick: vi.fn(), onPickRecipe: vi.fn(), onClose: vi.fn() };
  renderWired(<IngredientPicker recipeId="r-veloute" {...props} />);
  return props;
}

const combobox = () => screen.getByRole("combobox", { name: "Ingredient or Recipe" });
const type = (text: string) => fireEvent.change(combobox(), { target: { value: text } });
const press = (key: string) => fireEvent.keyDown(combobox(), { key });
const options = () => screen.getAllByRole("option");
// The option the input names as active, by its text.
const active = () => {
  const id = combobox().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent : undefined;
};

describe("Ingredient picker", () => {
  it("opens focused, offering the kitchen's other Recipes before anything is typed", async () => {
    renderPicker();
    expect(document.activeElement).toBe(combobox());
    const recipes = await screen.findByRole("group", { name: "Recipes" });
    expect(
      within(recipes)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Beurre blanc", "Chicken stock"]);
    expect(screen.queryByRole("group", { name: "Ingredients" })).toBeNull();
    expect(combobox().getAttribute("aria-expanded")).toBe("true");
  });

  it("lists the Ingredients found, marking a match by alias, then the Recipes that match", async () => {
    renderPicker();
    type("stock");
    const ingredients = await screen.findByRole("group", { name: "Ingredients" });
    expect(
      within(ingredients)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["onion", "shallot (alias)"]);
    expect(fetchIngredients).toHaveBeenLastCalledWith("stock");
    const recipes = screen.getByRole("group", { name: "Recipes" });
    expect(
      within(recipes)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Chicken stock"]);
  });

  it("shows no list when nothing matches, and Enter then picks nothing", async () => {
    const { onPick, onPickRecipe, onClose } = renderPicker();
    await screen.findByRole("listbox");
    type("zzz");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    expect(combobox().getAttribute("aria-controls")).toBeNull();

    press("ArrowDown");
    expect(combobox().getAttribute("aria-activedescendant")).toBeNull();
    press("Enter");
    expect(onPick).not.toHaveBeenCalled();
    expect(onPickRecipe).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves down through both groups with the arrow keys, wrapping at each end", async () => {
    renderPicker();
    type("on");
    await screen.findByRole("group", { name: "Ingredients" });
    const all = options().map((o) => o.textContent);
    expect(active()).toBeUndefined();

    press("ArrowDown");
    expect(active()).toBe(all[0]);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    press("ArrowDown");
    expect(active()).toBe(all[1]);
    for (let i = 2; i < all.length; i++) press("ArrowDown");
    expect(active()).toBe(all.at(-1));
    press("ArrowDown");
    expect(active()).toBe(all[0]);
  });

  it("moves up from nothing to the last option, and from the first back to the last", async () => {
    renderPicker();
    const all = (await screen.findAllByRole("option")).map((o) => o.textContent);

    press("ArrowUp");
    expect(active()).toBe(all.at(-1));
    press("ArrowUp");
    expect(active()).toBe(all.at(-2));
    press("ArrowDown");
    press("ArrowDown");
    expect(active()).toBe(all[0]);
    press("ArrowUp");
    expect(active()).toBe(all.at(-1));
  });

  it("picks the active Ingredient with Enter", async () => {
    const { onPick, onPickRecipe } = renderPicker();
    type("on");
    await screen.findByRole("group", { name: "Ingredients" });
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    expect(onPick).toHaveBeenCalledExactlyOnceWith(shallot);
    expect(onPickRecipe).not.toHaveBeenCalled();
  });

  it("picks the first option with Enter when none is active", async () => {
    const { onPick } = renderPicker();
    type("on");
    await screen.findByRole("group", { name: "Ingredients" });
    press("Enter");
    expect(onPick).toHaveBeenCalledExactlyOnceWith(onion);
  });

  it("picks the active Recipe with Enter", async () => {
    const { onPick, onPickRecipe } = renderPicker();
    await screen.findByRole("group", { name: "Recipes" });
    press("ArrowUp");
    press("Enter");
    expect(onPickRecipe).toHaveBeenCalledExactlyOnceWith(pickedStock);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("forgets the active option when the cook types again", async () => {
    renderPicker();
    await screen.findByRole("group", { name: "Recipes" });
    press("ArrowDown");
    expect(active()).toBe("Beurre blanc");
    type("stock");
    await screen.findByRole("group", { name: "Ingredients" });
    expect(combobox().getAttribute("aria-activedescendant")).toBeNull();
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true")).toEqual([]);
  });

  it("picks an Ingredient or a Recipe on a click, keeping focus on the input", async () => {
    const { onPick, onPickRecipe } = renderPicker();
    type("stock");
    const option = await screen.findByRole("option", { name: "onion" });
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(onPick).toHaveBeenCalledExactlyOnceWith(onion);

    fireEvent.click(screen.getByRole("option", { name: "Chicken stock" }));
    expect(onPickRecipe).toHaveBeenCalledExactlyOnceWith(pickedStock);
  });

  it("closes on Escape, handing back what the cook typed", () => {
    const { onClose, onPick } = renderPicker();
    type("leek");
    press("Escape");
    expect(onClose).toHaveBeenCalledExactlyOnceWith("leek");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("closes on {, handing back what the cook typed with the {", () => {
    const { onClose } = renderPicker();
    type("leek");
    press("{");
    expect(onClose).toHaveBeenCalledExactlyOnceWith("leek{");
  });

  it("shows why the Ingredient search failed", async () => {
    vi.mocked(fetchIngredients).mockRejectedValue(new Error("Could not search (500)"));
    renderPicker();
    expect((await screen.findByRole("alert")).textContent).toBe("Could not search (500)");
  });
});
