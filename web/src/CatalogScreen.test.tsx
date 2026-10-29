import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import {
  type CatalogIngredient,
  fetchIngredients,
  fetchShoppingCategories,
  mutate,
} from "./api.ts";
import { CatalogScreen, useAddAlias, useCatalog, useNewIngredient } from "./CatalogScreen.tsx";

// The network boundary only: the hooks' queries and mutations run through a real QueryClient.
vi.mock("./api.ts", () => ({
  fetchIngredients: vi.fn(),
  fetchShoppingCategories: vi.fn(),
  mutate: vi.fn(),
}));

// Any made-up id: the hooks make ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

const vegetables = { id: "cat-veg", name: "Vegetables", position: "a0" };
const meat = { id: "cat-meat", name: "Meat", position: "a1" };

// A seed Ingredient from ADR 0004's velouté.
const onion: CatalogIngredient = {
  id: "i-onion",
  name: "onion",
  source: "seed",
  preferredKind: "mass",
  mainUnit: "g",
  shoppingCategory: { id: vegetables.id, name: vegetables.name },
  aliases: [],
  matchedBy: "name",
  exact: true,
  overridden: false,
  overrideId: null,
};
// The kitchen's own Ingredient for the chicken stock, once it is created.
const wings: CatalogIngredient = {
  ...onion,
  id: "i-wings",
  name: "chicken wings",
  source: "own",
  preferredKind: "count",
  mainUnit: null,
  shoppingCategory: { id: meat.id, name: meat.name },
};

beforeEach(() => {
  vi.mocked(fetchIngredients)
    .mockReset()
    .mockImplementation((q) => Promise.resolve(q === "chicken wings" ? [wings] : [onion]));
  vi.mocked(fetchShoppingCategories).mockReset().mockResolvedValue([vegetables, meat]);
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});

// The args of the mutation sent with this name.
const sent = (name: string) => vi.mocked(mutate).mock.calls.find((call) => call[1] === name)?.[2];

// A save that stays pending until the test fails it.
function failLater() {
  let fail: (error: Error) => void = () => {};
  vi.mocked(mutate).mockReturnValue(new Promise((_, reject) => (fail = reject)));
  return (error: Error) => act(() => fail(error));
}

describe("Catalog hook", () => {
  it("searches the whole catalog at first, then for what the cook types", async () => {
    const { result } = renderQueryHook(() => useCatalog());
    expect(result.current.query).toBe("");
    await waitFor(() => expect(result.current.results.data).toEqual([onion]));
    expect(fetchIngredients).toHaveBeenLastCalledWith("");

    act(() => result.current.onQueryChange("chicken wings"));
    expect(result.current.query).toBe("chicken wings");
    await waitFor(() => expect(result.current.results.data).toEqual([wings]));
    expect(fetchIngredients).toHaveBeenLastCalledWith("chicken wings");
  });

  it("returns the search's error", async () => {
    vi.mocked(fetchIngredients).mockRejectedValue(new Error("Could not search (500)"));
    const { result } = renderQueryHook(() => useCatalog());
    await waitFor(() =>
      expect(result.current.results.error).toEqual(new Error("Could not search (500)")),
    );
  });
});

describe("Add alias hook", () => {
  it("adds the alias to this Ingredient, refreshes every search, then reports it added", async () => {
    const { result, client } = renderQueryHook(() => useAddAlias("i-onion"));
    client.setQueryData(["ingredients", "oni"], [onion]);
    client.setQueryData(["recipes"], []);
    const onAdded = vi.fn();

    act(() => result.current.onAddAlias("oignon", onAdded));
    await waitFor(() => expect(onAdded).toHaveBeenCalledOnce());
    expect(sent("addAlias")).toEqual({ aliasId: anId, ingredientId: "i-onion", name: "oignon" });
    expect(vi.mocked(mutate).mock.calls[0][0]).toEqual(anId);
    expect(client.getQueryState(["ingredients", "oni"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(false);
  });

  it("returns the add as pending, then its error, without reporting it added", async () => {
    const fail = failLater();
    const { result } = renderQueryHook(() => useAddAlias("i-onion"));
    const onAdded = vi.fn();

    expect(result.current).toMatchObject({ addAliasPending: false, addAliasError: null });
    act(() => result.current.onAddAlias("oignon", onAdded));
    await waitFor(() => expect(result.current.addAliasPending).toBe(true));
    fail(new Error("Could not save (500)"));
    await waitFor(() =>
      expect(result.current.addAliasError).toEqual(new Error("Could not save (500)")),
    );
    expect(result.current.addAliasPending).toBe(false);
    expect(onAdded).not.toHaveBeenCalled();
  });
});

describe("New Ingredient hook", () => {
  const input = { name: "chicken wings", preferredKind: "count", shoppingCategoryId: "cat-meat" };

  it("returns the Shopping categories it fetched", async () => {
    const { result } = renderQueryHook(() => useNewIngredient(vi.fn()));
    await waitFor(() => expect(result.current.categories.data).toEqual([vegetables, meat]));
    expect(result.current).toMatchObject({ createPending: false, createError: null });
  });

  it("creates the Ingredient, refreshes every search, then searches for its name", async () => {
    const onCreated = vi.fn();
    const { result, client } = renderQueryHook(() => useNewIngredient(onCreated));
    client.setQueryData(["ingredients", ""], [onion]);
    const onSaved = vi.fn();

    // The search waits for the refresh.
    onCreated.mockImplementation(() =>
      expect(client.getQueryState(["ingredients", ""])?.isInvalidated).toBe(true),
    );
    act(() => result.current.onCreate(input, onSaved));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(sent("createIngredient")).toEqual({ ingredientId: anId, ...input });
    expect(vi.mocked(mutate).mock.calls[0][0]).toEqual(anId);
    expect(onCreated).toHaveBeenCalledExactlyOnceWith("chicken wings");
    expect(onCreated).toHaveReturned();
  });

  it("returns the create as pending, then its error, without searching for it", async () => {
    const fail = failLater();
    const onCreated = vi.fn();
    const onSaved = vi.fn();
    const { result } = renderQueryHook(() => useNewIngredient(onCreated));

    act(() => result.current.onCreate(input, onSaved));
    await waitFor(() => expect(result.current.createPending).toBe(true));
    fail(new Error("Could not save (500)"));
    await waitFor(() =>
      expect(result.current.createError).toEqual(new Error("Could not save (500)")),
    );
    expect(result.current.createPending).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("returns the Shopping categories' error", async () => {
    vi.mocked(fetchShoppingCategories).mockRejectedValue(new Error("Could not load (500)"));
    const { result } = renderQueryHook(() => useNewIngredient(vi.fn()));
    await waitFor(() =>
      expect(result.current.categories.error).toEqual(new Error("Could not load (500)")),
    );
  });
});

describe("Catalog screen", () => {
  const search = () => screen.getByRole("searchbox", { name: "Search ingredients" });
  const list = () => screen.getByRole("list", { name: "Ingredients" });

  it("wires the search into the view: what the cook types finds its Ingredients", async () => {
    renderWired(<CatalogScreen />);
    expect(await within(list()).findByText("onion")).toBeTruthy();

    fireEvent.change(search(), { target: { value: "chicken wings" } });
    expect(await within(list()).findByText("chicken wings")).toBeTruthy();
    expect(within(list()).queryByText("onion")).toBeNull();
  });

  it("wires each Ingredient's alias form: the alias is saved for that Ingredient, then the search refetches", async () => {
    renderWired(<CatalogScreen />);
    const item = (await within(list()).findByText("onion")).closest("li")!;
    fireEvent.change(within(item).getByRole("textbox", { name: "Alias" }), {
      target: { value: "oignon" },
    });
    fireEvent.click(within(item).getByRole("button", { name: "Add alias" }));
    await waitFor(() => expect(fetchIngredients).toHaveBeenCalledTimes(2));
    expect(sent("addAlias")).toEqual({ aliasId: anId, ingredientId: "i-onion", name: "oignon" });
    await waitFor(() =>
      expect(within(item).getByRole("textbox", { name: "Alias" })).toHaveProperty("value", ""),
    );
  });

  it("wires the New Ingredient form: the Ingredient is saved, then searched for by its name", async () => {
    renderWired(<CatalogScreen />);
    const create = screen.getByRole("button", { name: "Create Ingredient" });
    await waitFor(() => expect(create).toHaveProperty("disabled", false));
    fireEvent.change(screen.getByRole("textbox", { name: "Ingredient name" }), {
      target: { value: "chicken wings" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Kind of measure" }), {
      target: { value: "count" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Shopping category" }), {
      target: { value: "cat-meat" },
    });
    fireEvent.click(create);

    expect(await within(list()).findByText("chicken wings")).toBeTruthy();
    expect(sent("createIngredient")).toEqual({
      ingredientId: anId,
      name: "chicken wings",
      preferredKind: "count",
      shoppingCategoryId: "cat-meat",
    });
    expect(search()).toHaveProperty("value", "chicken wings");
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Ingredient name" })).toHaveProperty("value", ""),
    );
  });

  it("wires the create's pending state and error into the view", async () => {
    renderWired(<CatalogScreen />);
    const create = screen.getByRole("button", { name: "Create Ingredient" });
    await waitFor(() => expect(create).toHaveProperty("disabled", false));
    const fail = failLater();
    fireEvent.change(screen.getByRole("textbox", { name: "Ingredient name" }), {
      target: { value: "chicken wings" },
    });
    fireEvent.click(create);
    await waitFor(() => expect(create).toHaveProperty("disabled", true));
    fail(new Error("Could not save (500)"));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not save (500)");
  });
});
