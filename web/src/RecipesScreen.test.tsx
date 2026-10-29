import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import { fetchRecipes, mutate, type RecipeListItem } from "./api.ts";
import { RecipesScreen, useRecipesScreen } from "./RecipesScreen.tsx";

// The network boundary only: the hook's query and mutation run through a real QueryClient.
vi.mock("./api.ts", () => ({ fetchRecipes: vi.fn(), mutate: vi.fn() }));

// Any made-up id: the hook makes ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

// ADR 0004's Velouté, before it has a yield.
const velouté: RecipeListItem = {
  id: "r-veloute",
  name: "Velouté",
  servings: 6,
  yield: null,
  latestRevision: 1,
};

beforeEach(() => {
  vi.mocked(fetchRecipes).mockReset().mockResolvedValue([velouté]);
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

describe("Recipes list hook", () => {
  it("returns the Recipes it fetched", async () => {
    const { result } = renderQueryHook(() => useRecipesScreen(vi.fn()));
    await waitFor(() => expect(result.current.recipes.data).toEqual([velouté]));
    expect(result.current).toMatchObject({ createPending: false, createError: null });
  });

  it("creates the Recipe, refreshes the Recipes, then opens the new Recipe", async () => {
    const onOpen = vi.fn();
    const { result } = renderQueryHook(() => useRecipesScreen(onOpen));
    await waitFor(() => expect(result.current.recipes.status).toBe("success"));

    // The open waits for the refresh, so the list is already refetching when it runs.
    onOpen.mockImplementation(() => expect(fetchRecipes).toHaveBeenCalledTimes(2));
    act(() => result.current.onCreate("Tarte tatin"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
    const args = sent("createRecipe");
    expect(args).toEqual({ recipeId: anId, revisionId: anId, name: "Tarte tatin" });
    expect(vi.mocked(mutate).mock.calls[0][0]).toEqual(anId);
    expect(onOpen).toHaveBeenCalledWith(args?.recipeId);
    expect(onOpen).toHaveReturned();
  });

  it("gives each create new ids", async () => {
    const { result } = renderQueryHook(() => useRecipesScreen(vi.fn()));
    act(() => result.current.onCreate("Tarte tatin"));
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    act(() => result.current.onCreate("Tarte tatin"));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(mutate).mock.calls;
    expect(second[0]).not.toBe(first[0]);
    expect(second[2].recipeId).not.toBe(first[2].recipeId);
    expect(second[2].revisionId).not.toBe(first[2].revisionId);
  });

  it("returns the create as pending, then its error, without opening a Recipe", async () => {
    const fail = failLater();
    const onOpen = vi.fn();
    const { result } = renderQueryHook(() => useRecipesScreen(onOpen));

    act(() => result.current.onCreate("Tarte tatin"));
    await waitFor(() => expect(result.current.createPending).toBe(true));
    fail(new Error("Could not save (500)"));
    await waitFor(() =>
      expect(result.current.createError).toEqual(new Error("Could not save (500)")),
    );
    expect(result.current.createPending).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("returns the fetch's error", async () => {
    vi.mocked(fetchRecipes).mockRejectedValue(new Error("Could not load the Recipes (500)"));
    const { result } = renderQueryHook(() => useRecipesScreen(vi.fn()));
    await waitFor(() =>
      expect(result.current.recipes.error).toEqual(new Error("Could not load the Recipes (500)")),
    );
  });
});

describe("Recipes screen", () => {
  it("wires the list into the view: a click opens the Recipe", async () => {
    const onOpen = vi.fn();
    renderWired(<RecipesScreen onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole("link", { name: "Velouté" }));
    expect(onOpen).toHaveBeenCalledWith("r-veloute");
  });

  it("wires the create into the view: the typed name is saved, then the Recipe opens", async () => {
    const onOpen = vi.fn();
    renderWired(<RecipesScreen onOpen={onOpen} />);
    await within(screen.getByRole("list", { name: "Recipes" })).findByRole("link");

    fireEvent.change(screen.getByRole("textbox", { name: "Recipe name" }), {
      target: { value: "Tarte tatin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Recipe" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
    expect(sent("createRecipe")).toEqual({ recipeId: anId, revisionId: anId, name: "Tarte tatin" });
    expect(onOpen).toHaveBeenCalledWith(sent("createRecipe")?.recipeId);
  });

  it("wires the create's pending state and error into the view", async () => {
    const fail = failLater();
    renderWired(<RecipesScreen onOpen={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Recipe name" }), {
      target: { value: "Tarte tatin" },
    });
    const create = screen.getByRole("button", { name: "Create Recipe" });
    fireEvent.click(create);
    await waitFor(() => expect(create).toHaveProperty("disabled", true));
    fail(new Error("Could not save (500)"));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not save (500)");
  });
});
