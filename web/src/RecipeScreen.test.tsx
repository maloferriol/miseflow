import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chickenStock, tarteTatin } from "../test/recipe-fixtures.ts";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import { fetchIngredients, fetchRecipe, fetchRecipes, mutate } from "./api.ts";
import { useExtractToSubRecipe } from "./ExtractToSubRecipe.tsx";
import { RecipeScreen, useRecipeScreen } from "./RecipeScreen.tsx";
import { ingredientText } from "./recipe-screen.ts";
import { useYieldField } from "./YieldField.tsx";

// The network boundary only: the hooks' queries and mutations run through a real QueryClient.
vi.mock("./api.ts", () => ({
  fetchIngredients: vi.fn(),
  fetchRecipe: vi.fn(),
  fetchRecipes: vi.fn(),
  fetchShoppingCategories: vi.fn(),
  mutate: vi.fn(),
}));

// Any made-up id: the hooks make ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

// The calls sent with this mutation name: [id, name, args].
const sentCalls = (name: string) => vi.mocked(mutate).mock.calls.filter((call) => call[1] === name);
const sent = (name: string) => sentCalls(name).at(-1)?.[2];

const tarteLink = "/?view=recipe&recipe=r-tarte";

beforeEach(() => {
  window.history.replaceState(null, "", tarteLink);
  vi.mocked(fetchRecipe).mockReset().mockResolvedValue(tarteTatin);
  vi.mocked(fetchRecipes).mockReset().mockResolvedValue([]);
  vi.mocked(fetchIngredients).mockReset().mockResolvedValue([]);
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});

async function openTarte(link = tarteLink) {
  window.history.replaceState(null, "", link);
  const wired = renderWired(<RecipeScreen recipeId="r-tarte" />);
  await screen.findByRole("heading", { name: "Tarte tatin" });
  // A cached Recipe list, to see what an edit invalidates.
  wired.client.setQueryData(["recipes"], []);
  return wired;
}

const stepsList = () => screen.getByRole("list", { name: "Steps" });
const extractGroup = () => screen.getByRole("group", { name: "Extract to sub-recipe" });

describe("Recipe screen", () => {
  it("shows Loading until the Recipe arrives, then its Steps and ingredient list", async () => {
    renderWired(<RecipeScreen recipeId="r-tarte" />);
    expect(screen.getByText("Loading…")).toBeTruthy();

    await screen.findByRole("heading", { name: "Tarte tatin" });
    expect(fetchRecipe).toHaveBeenCalledWith("r-tarte");
    expect(screen.getByRole("textbox", { name: "Recipe name" })).toHaveProperty(
      "value",
      "Tarte tatin",
    );
    expect(screen.getByRole("spinbutton", { name: "Servings" })).toHaveProperty("value", "6");
    expect(within(stepsList()).getAllByRole("listitem")).toHaveLength(3);
    expect(within(stepsList()).getByText("Rest the pastry")).toBeTruthy();

    const lines = new Map(tarteTatin.steps.flatMap((s) => s.lines).map((l) => [l.id, l]));
    const rows = within(screen.getByRole("list", { name: "Ingredients" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(
      tarteTatin.ingredients.map((item) => ingredientText(item, lines.get(item.lineId))),
    );
  });

  it("shows why the Recipe didn't load", async () => {
    vi.mocked(fetchRecipe).mockRejectedValue(new Error("Could not load the Recipe (404)"));
    renderWired(<RecipeScreen recipeId="r-tarte" />);
    expect((await screen.findByRole("alert")).textContent).toBe("Could not load the Recipe (404)");
  });

  it("opens in Write with no mode in its link", async () => {
    await openTarte();
    expect(screen.getByRole("button", { name: "Write" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Plan" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("list", { name: "Planning" })).toBeNull();
  });

  it("opens at the Planning pass when its link says mode=plan", async () => {
    await openTarte(`${tarteLink}&mode=plan`);
    expect(screen.getByRole("button", { name: "Plan" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("list", { name: "Planning" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ready to plan" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Extract to sub-recipe" })).toBeNull();
  });

  it("switches to Plan and back, keeping the mode in its link", async () => {
    await openTarte();

    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByRole("list", { name: "Planning" })).toBeTruthy();
    expect(window.location.search).toBe("?view=recipe&recipe=r-tarte&mode=plan");

    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    expect(stepsList()).toBeTruthy();
    expect(window.location.search).toBe("?view=recipe&recipe=r-tarte");
  });

  it("saves the name and Servings as editRecipe, then refetches the Recipe and the list", async () => {
    const { client } = await openTarte();

    fireEvent.change(screen.getByRole("textbox", { name: "Recipe name" }), {
      target: { value: " Tarte Tatin aux pommes " },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Servings" }), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));

    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledTimes(2));
    expect(sent("editRecipe")).toEqual({
      recipeId: "r-tarte",
      revisionId: anId,
      name: "Tarte Tatin aux pommes",
      servings: 8,
    });
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true);
  });

  it("moves a Step up after the Step two above it, and down after the Step below", async () => {
    await openTarte();
    const [rub, rest, caramelise] = within(stepsList()).getAllByRole("listitem");
    expect(within(rub).getByRole("button", { name: "Move up" })).toHaveProperty("disabled", true);
    expect(within(caramelise).getByRole("button", { name: "Move down" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(within(caramelise).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledTimes(2));
    expect(sent("moveStep")).toEqual({
      revisionId: anId,
      stepId: "s-caramelise",
      afterStepId: "s-rub",
    });

    fireEvent.click(within(rest).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledTimes(3));
    expect(sent("moveStep")).toEqual({
      revisionId: anId,
      stepId: "s-rest",
      afterStepId: "s-caramelise",
    });
  });

  it("removes a Step with removeStep", async () => {
    await openTarte();
    const rest = within(stepsList()).getAllByRole("listitem")[1];

    fireEvent.click(within(rest).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledTimes(2));
    expect(sent("removeStep")).toEqual({ stepId: "s-rest", revisionId: anId });
  });

  it("shows a failed move and refetches the Recipe anyway, since the server may hold it", async () => {
    vi.mocked(mutate).mockRejectedValue(new Error("Conflict (409)"));
    const { client } = await openTarte();
    const rest = within(stepsList()).getAllByRole("listitem")[1];

    fireEvent.click(within(rest).getByRole("button", { name: "Move up" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Conflict (409)");
    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true);
  });

  it("opens a new Step's editor from Add Step, and Cancel puts the button back", async () => {
    await openTarte();

    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));
    expect(screen.getByRole("textbox", { name: "Step text" })).toHaveProperty("value", "");
    expect(screen.queryByRole("button", { name: "Add Step" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add Step" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Step text" })).toBeNull();
  });

  it("extracts the ticked Steps with the typed name and amount, then clears the ticks and fields", async () => {
    const { client } = await openTarte();
    const extract = extractGroup();
    const extractButton = within(extract).getByRole("button", { name: "Extract to sub-recipe" });
    expect(extractButton).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 1" }));
    fireEvent.change(within(extract).getByRole("textbox", { name: "Name for the sub-recipe" }), {
      target: { value: " Pastry " },
    });
    fireEvent.change(within(extract).getByRole("textbox", { name: "Amount used" }), {
      target: { value: "500%g" },
    });
    expect(extractButton).toHaveProperty("disabled", false);
    fireEvent.click(extractButton);

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Select Step 1" })).toHaveProperty(
        "checked",
        false,
      ),
    );
    expect(sent("extractToSubRecipe")).toEqual({
      recipeId: "r-tarte",
      revisionId: anId,
      subRecipeId: anId,
      subRecipeRevisionId: anId,
      stepId: anId,
      lineId: anId,
      stepIds: ["s-rub", "s-rest"],
      name: "Pastry",
      amount: "500%g",
    });
    expect(screen.getByRole("checkbox", { name: "Select Step 2" })).toHaveProperty(
      "checked",
      false,
    );
    expect(
      within(extract).getByRole("textbox", { name: "Name for the sub-recipe" }),
    ).toHaveProperty("value", "");
    expect(within(extract).getByRole("textbox", { name: "Amount used" })).toHaveProperty(
      "value",
      "1",
    );
    expect(fetchRecipe).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true);
  });

  it("won't extract Steps that don't follow one another, and says why", async () => {
    await openTarte();
    const extract = extractGroup();
    fireEvent.change(within(extract).getByRole("textbox", { name: "Name for the sub-recipe" }), {
      target: { value: "Pastry" },
    });
    expect(within(extract).queryByText("Select Steps that follow one another.")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 3" }));
    expect(within(extract).getByText("Select Steps that follow one another.")).toBeTruthy();
    expect(within(extract).getByRole("button", { name: "Extract to sub-recipe" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 3" }));
    expect(within(extract).queryByText("Select Steps that follow one another.")).toBeNull();
    expect(within(extract).getByRole("button", { name: "Extract to sub-recipe" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("forgets a ticked Step once it is removed", async () => {
    await openTarte();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 3" }));

    // Remove Rest the pastry: Caramelise is now Step 2, and alone it can be extracted.
    vi.mocked(fetchRecipe).mockResolvedValue({
      ...tarteTatin,
      steps: tarteTatin.steps.filter((s) => s.id !== "s-rest"),
    });
    const rest = within(stepsList()).getAllByRole("listitem")[1];
    fireEvent.click(within(rest).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(within(stepsList()).getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getByRole("checkbox", { name: "Select Step 2" })).toHaveProperty("checked", true);

    const extract = extractGroup();
    fireEvent.change(within(extract).getByRole("textbox", { name: "Name for the sub-recipe" }), {
      target: { value: "Caramel" },
    });
    fireEvent.click(within(extract).getByRole("button", { name: "Extract to sub-recipe" }));
    await waitFor(() => expect(sent("extractToSubRecipe")).toBeDefined());
    expect(sent("extractToSubRecipe")).toMatchObject({ stepIds: ["s-caramelise"] });
  });

  it("saves the yield with setYield, then refetches the Recipe and the list", async () => {
    const { client } = await openTarte();

    fireEvent.change(screen.getByRole("textbox", { name: "Yield" }), {
      target: { value: " 1 tart " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save yield" }));

    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledTimes(2));
    expect(sent("setYield")).toEqual({ recipeId: "r-tarte", revisionId: anId, yield: "1 tart" });
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true);
  });

  it("says a sub-recipe needs a yield, naming the Recipes that use it", async () => {
    vi.mocked(fetchRecipe).mockResolvedValue(chickenStock);
    renderWired(<RecipeScreen recipeId="r-stock" />);
    await screen.findByRole("heading", { name: "Chicken stock" });
    expect(screen.getByText(/used as a sub-recipe by Velouté/).textContent).toBe(
      "needs a yield: used as a sub-recipe by Velouté",
    );
  });
});

describe("Recipe screen hook", () => {
  it("retries a failed edit with the same ids, and refetches after each try", async () => {
    vi.mocked(mutate).mockRejectedValueOnce(new Error("Network error"));
    const { result, client } = renderQueryHook(() => useRecipeScreen("r-tarte"));
    await waitFor(() => expect(result.current.recipe.status).toBe("success"));
    client.setQueryData(["recipes"], []);

    act(() => result.current.onEdit({ name: "Tarte tatin", servings: 8 }));
    await waitFor(() => expect(result.current.editError?.message).toBe("Network error"));
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true);
    client.setQueryData(["recipes"], []);

    act(() => result.current.onEdit({ name: "Tarte tatin", servings: 8 }));
    await waitFor(() => expect(result.current.editError).toBeNull());
    await waitFor(() => expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true));
    const [first, retry] = sentCalls("editRecipe");
    expect(retry[0]).toBe(first[0]);
    expect(retry[2]).toEqual(first[2]);
  });

  it("opens on the mode in the link, and tells the view which Steps are ticked", async () => {
    window.history.replaceState(null, "", `${tarteLink}&mode=plan`);
    const { result } = renderQueryHook(() => useRecipeScreen("r-tarte"));
    await waitFor(() => expect(result.current.recipe.status).toBe("success"));
    expect(result.current.mode).toBe("plan");

    act(() => result.current.onSelect("s-rest"));
    act(() => result.current.onSelect("s-gone"));
    act(() => result.current.onSelect("s-rub"));
    expect(result.current.selected).toEqual(["s-rest", "s-rub"]);
    act(() => result.current.onUnselect("s-rest"));
    expect(result.current.selected).toEqual(["s-rub"]);
    act(() => result.current.onClearSelection());
    expect(result.current.selected).toEqual([]);
  });
});

describe("Yield field hook", () => {
  it("saves with setYield and refetches the Recipe and the list", async () => {
    const { result, client } = renderQueryHook(() => useYieldField("r-stock"));
    client.setQueryData(["recipe", "r-stock"], chickenStock);
    client.setQueryData(["recipes"], []);

    act(() => result.current.onSave("1.5 L"));
    await waitFor(() => expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true));
    expect(mutate).toHaveBeenCalledWith(anId, "setYield", {
      recipeId: "r-stock",
      revisionId: anId,
      yield: "1.5 L",
    });
    expect(client.getQueryState(["recipe", "r-stock"])?.isInvalidated).toBe(true);
  });

  it("shows a failed save, refetches nothing, and retries it with the same ids", async () => {
    vi.mocked(mutate).mockRejectedValueOnce(new Error("Network error"));
    const { result, client } = renderQueryHook(() => useYieldField("r-stock"));
    client.setQueryData(["recipe", "r-stock"], chickenStock);

    act(() => result.current.onSave(null));
    await waitFor(() => expect(result.current.saveError?.message).toBe("Network error"));
    expect(client.getQueryState(["recipe", "r-stock"])?.isInvalidated).toBe(false);

    act(() => result.current.onSave(null));
    await waitFor(() =>
      expect(client.getQueryState(["recipe", "r-stock"])?.isInvalidated).toBe(true),
    );
    const [first, retry] = sentCalls("setYield");
    expect(retry[0]).toBe(first[0]);
    expect(retry[2]).toEqual({ recipeId: "r-stock", revisionId: anId, yield: null });
    expect(retry[2]).toEqual(first[2]);
  });
  it("saves the same yield again as a new save once the first went through", async () => {
    const { result } = renderQueryHook(() => useYieldField("r-stock"));
    act(() => result.current.onSave("1.5 L"));
    await waitFor(() => expect(sentCalls("setYield")).toHaveLength(1));
    await waitFor(() => expect(result.current.savePending).toBe(false));

    act(() => result.current.onSave("1.5 L"));
    await waitFor(() => expect(sentCalls("setYield")).toHaveLength(2));
    const [first, again] = sentCalls("setYield");
    expect(again[0]).not.toBe(first[0]);
  });
});

describe("Extract to sub-recipe hook", () => {
  const args = { stepIds: ["s-rub", "s-rest"], name: "Pastry", amount: "1" };

  it("starts with no name and an amount of 1, and keeps what the cook types", () => {
    const { result } = renderQueryHook(() => useExtractToSubRecipe("r-tarte", vi.fn()));
    expect(result.current).toMatchObject({ name: "", amount: "1", extractPending: false });

    act(() => result.current.onName("Pastry"));
    act(() => result.current.onAmount("500%g"));
    expect(result.current).toMatchObject({ name: "Pastry", amount: "500%g" });
  });

  it("extracts with extractToSubRecipe, refetches, clears the fields and says it's done", async () => {
    const onDone = vi.fn();
    const { result, client } = renderQueryHook(() => useExtractToSubRecipe("r-tarte", onDone));
    client.setQueryData(["recipe", "r-tarte"], tarteTatin);
    client.setQueryData(["recipes"], []);
    act(() => result.current.onName("Pastry"));
    act(() => result.current.onAmount("500%g"));

    act(() => result.current.onExtract(args));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(mutate).toHaveBeenCalledWith(anId, "extractToSubRecipe", {
      recipeId: "r-tarte",
      revisionId: anId,
      subRecipeId: anId,
      subRecipeRevisionId: anId,
      stepId: anId,
      lineId: anId,
      ...args,
    });
    expect(result.current).toMatchObject({ name: "", amount: "1" });
    expect(client.getQueryState(["recipe", "r-tarte"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true);
  });

  it("keeps the fields after a failed extract, and retries it with the same ids", async () => {
    vi.mocked(mutate).mockRejectedValueOnce(new Error("Network error"));
    const onDone = vi.fn();
    const { result } = renderQueryHook(() => useExtractToSubRecipe("r-tarte", onDone));
    act(() => result.current.onName("Pastry"));

    act(() => result.current.onExtract(args));
    await waitFor(() => expect(result.current.extractError?.message).toBe("Network error"));
    expect(result.current.name).toBe("Pastry");
    expect(onDone).not.toHaveBeenCalled();

    act(() => result.current.onExtract(args));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    const [first, retry] = sentCalls("extractToSubRecipe");
    expect(retry[0]).toBe(first[0]);
    expect(retry[2]).toEqual(first[2]);
  });
  it("extracts the same Steps again as a new extract once the first went through", async () => {
    const onDone = vi.fn();
    const { result } = renderQueryHook(() => useExtractToSubRecipe("r-tarte", onDone));
    act(() => result.current.onExtract(args));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());

    act(() => result.current.onExtract(args));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
    const [first, again] = sentCalls("extractToSubRecipe");
    expect(again[0]).not.toBe(first[0]);
    expect(again[2]).not.toEqual(first[2]);
  });
});
