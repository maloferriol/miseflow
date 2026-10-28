import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import {
  type CatalogIngredient,
  fetchIngredients,
  fetchRecipes,
  fetchShoppingCategories,
  mutate,
  type RecipeStep,
} from "./api.ts";
import { insertPick } from "./step-editor.ts";
import { StepEditor, useStepForm } from "./StepEditor.tsx";

// The network boundary only: the hook's queries and mutations run through a real QueryClient.
vi.mock("./api.ts", () => ({
  fetchIngredients: vi.fn(),
  fetchRecipes: vi.fn(),
  fetchShoppingCategories: vi.fn(),
  mutate: vi.fn(),
}));

// Any made-up id: the hook makes ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

function ingredient(id: string, name: string, exact: boolean): CatalogIngredient {
  return {
    id,
    name,
    source: "seed",
    preferredKind: "count",
    mainUnit: null,
    shoppingCategory: { id: "veg-id", name: "Vegetables" },
    aliases: [],
    matchedBy: "name",
    exact,
    overridden: false,
    overrideId: null,
  };
}

const shallots = ingredient("i-shallot", "shallots", false);
const onion = ingredient("i-onion", "onion", true);

// "Sweat @shallots{2%clove}(diced) gently", saved with its line linked to shallots.
const step: RecipeStep = {
  id: "s-1",
  position: "a0",
  body: [
    { type: "text", text: "Sweat " },
    { type: "line", lineId: "l-shallots" },
    { type: "text", text: " gently" },
  ],
  lines: [
    {
      id: "l-shallots",
      wording: "shallots",
      quantity: 2,
      quantityMax: null,
      unit: "clove",
      fixedQuantity: false,
      preparation: "diced",
      ingredient: { id: "i-shallot", name: "shallots" },
      subRecipe: null,
      missingSubRecipe: false,
    },
  ],
  activeMinutes: null,
  passiveMinutes: null,
  groupWithPrevious: false,
  makeAhead: null,
  effectiveMakeAhead: null,
};

beforeEach(() => {
  vi.mocked(fetchIngredients).mockReset().mockResolvedValue([]);
  vi.mocked(fetchRecipes).mockReset().mockResolvedValue([]);
  vi.mocked(fetchShoppingCategories).mockReset().mockResolvedValue([]);
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});

// The args of the mutation sent with this name.
const sent = (name: string) => vi.mocked(mutate).mock.calls.find((call) => call[1] === name)?.[2];

function renderStepForm(opened?: RecipeStep) {
  const onDone = vi.fn();
  const hook = renderQueryHook(() => useStepForm("r-1", opened, onDone));
  // A cached Recipe and Recipe list, to see what a save invalidates.
  hook.client.setQueryData(["recipe", "r-1"], {});
  hook.client.setQueryData(["recipes"], []);
  return { onDone, ...hook };
}

describe("Step form hook", () => {
  it("opens a saved Step as its shorthand, with the picker shut and nothing unmatched", () => {
    const { result } = renderStepForm(step);
    expect(result.current).toMatchObject({
      text: "Sweat @shallots{2%clove}(diced) gently",
      pickerAt: null,
      unmatched: [],
      savePending: false,
      saveError: null,
    });
  });

  it("saves an opened Step as editStep, keeping its line, then refetches the Recipe and closes", async () => {
    const { result, client, onDone } = renderStepForm(step);

    act(() => result.current.onSave());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(sent("editStep")).toEqual({
      stepId: "s-1",
      revisionId: anId,
      body: [
        { type: "text", text: "Sweat " },
        { type: "line", lineId: "l-shallots" },
        { type: "text", text: " gently" },
      ],
      lines: [
        {
          lineId: "l-shallots",
          ingredientId: "i-shallot",
          amount: "2%clove",
          wording: "shallots",
          preparation: "diced",
        },
      ],
    });
    expect(client.getQueryState(["recipe", "r-1"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["recipes"])?.isInvalidated).toBe(true);
  });

  it("saves a new Step as addStep, with the text the cook typed", async () => {
    const { result, onDone } = renderStepForm();
    expect(result.current.text).toBe("");

    act(() => result.current.onEdit("Sweat the shallots", 18));
    act(() => result.current.onSave());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(sent("addStep")).toEqual({
      recipeId: "r-1",
      stepId: anId,
      revisionId: anId,
      body: [{ type: "text", text: "Sweat the shallots" }],
      lines: [],
    });
  });

  it("links a typed name that matches one Ingredient exactly, looked up in the catalog", async () => {
    vi.mocked(fetchIngredients).mockResolvedValue([onion]);
    const { result, onDone } = renderStepForm();

    act(() => result.current.onEdit("Dice @onion{1}", 14));
    act(() => result.current.onSave());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(fetchIngredients).toHaveBeenCalledWith("onion");
    expect(fetchRecipes).toHaveBeenCalled();
    expect(sent("addStep")?.lines).toEqual([
      {
        lineId: anId,
        ingredientId: "i-onion",
        amount: "1",
        wording: "onion",
        preparation: null,
      },
    ]);
  });

  it("holds the save while a name has no exact match, and sends it once the cook links one", async () => {
    vi.mocked(fetchIngredients).mockResolvedValue([shallots]);
    const { result, onDone } = renderStepForm();

    act(() => result.current.onEdit("Dice @shalot{2}", 15));
    act(() => result.current.onSave());
    await waitFor(() =>
      expect(result.current.unmatched).toEqual([
        { name: "shalot", amount: "2", near: [shallots], nearRecipes: [] },
      ]),
    );
    await waitFor(() => expect(result.current.savePending).toBe(false));
    expect(mutate).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    act(() => result.current.link("shalot", { ingredientId: "i-shallot" }));
    expect(result.current.unmatched).toEqual([]);
    act(() => result.current.onSave());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(sent("addStep")?.lines).toMatchObject([
      { ingredientId: "i-shallot", wording: "shalot" },
    ]);
  });

  it("opens the picker at the @ the cook types, and a pick shuts it and links the name", async () => {
    const { result, onDone } = renderStepForm();

    act(() => result.current.onEdit("Dice ", 5));
    expect(result.current.pickerAt).toBeNull();
    act(() => result.current.onEdit("Dice @", 6));
    expect(result.current.pickerAt).toBe(5);
    act(() => result.current.onInsert(insertPick("Dice @", 5, { ingredient: onion })));
    expect(result.current).toMatchObject({ text: "Dice @onion{}", pickerAt: null });

    act(() => result.current.onSave());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(fetchIngredients).not.toHaveBeenCalled();
    expect(sent("addStep")?.lines).toMatchObject([{ ingredientId: "i-onion", wording: "onion" }]);
  });

  it("returns the save as pending, then its error, refetching the Recipe and staying open", async () => {
    let fail: (error: Error) => void = () => {};
    vi.mocked(mutate).mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const { result, client, onDone } = renderStepForm(step);

    act(() => result.current.onSave());
    await waitFor(() => expect(result.current.savePending).toBe(true));
    act(() => fail(new Error("Could not save the Step (500)")));
    await waitFor(() =>
      expect(result.current.saveError).toEqual(new Error("Could not save the Step (500)")),
    );
    expect(result.current.savePending).toBe(false);
    expect(client.getQueryState(["recipe", "r-1"])?.isInvalidated).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("closes on Cancel without saving", () => {
    const { result, onDone } = renderStepForm(step);
    act(() => result.current.onCancel());
    expect(onDone).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("Step editor", () => {
  const textbox = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Step text" });

  it("wires the picker into the form: a pick writes the name into the Step text", async () => {
    vi.mocked(fetchIngredients).mockResolvedValue([onion]);
    renderWired(<StepEditor recipeId="r-1" />);

    fireEvent.change(textbox(), { target: { value: "Dice " } });
    fireEvent.change(textbox(), { target: { value: "Dice @" } });
    fireEvent.click(await screen.findByRole("option", { name: "onion" }));
    expect(textbox().value).toBe("Dice @onion{}");
  });

  it("wires a Recipe pick into the form as a sub-recipe", async () => {
    vi.mocked(fetchRecipes).mockResolvedValue([
      { id: "r-stock", name: "Chicken stock", servings: null, latestRevision: 1, yield: null },
    ]);
    renderWired(<StepEditor recipeId="r-1" />);

    fireEvent.change(textbox(), { target: { value: "Add " } });
    fireEvent.change(textbox(), { target: { value: "Add @" } });
    fireEvent.click(await screen.findByRole("option", { name: "Chicken stock" }));
    expect(textbox().value).toBe("Add @Chicken stock{}");
  });

  it("wires the picker's close into the form: what the cook typed goes back into the text", () => {
    renderWired(<StepEditor recipeId="r-1" />);

    fireEvent.change(textbox(), { target: { value: "Dice " } });
    fireEvent.change(textbox(), { target: { value: "Dice @" } });
    const picker = screen.getByRole("combobox", { name: "Ingredient or Recipe" });
    fireEvent.change(picker, { target: { value: "leek" } });
    fireEvent.keyDown(picker, { key: "Escape" });
    expect(textbox().value).toBe("Dice @leek");
  });

  it("wires each unmatched name's link choice into the form, so linking it lets Save through", async () => {
    vi.mocked(fetchIngredients).mockResolvedValue([shallots]);
    const onClose = vi.fn();
    renderWired(<StepEditor recipeId="r-1" step={step} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(textbox(), { target: { value: "Dice @shalot{2}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use shallots" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false),
    );
    expect(sent("addAlias")).toMatchObject({ ingredientId: "i-shallot", name: "shalot" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(sent("editStep")?.lines).toMatchObject([
      { ingredientId: "i-shallot", wording: "shalot" },
    ]);
  });
});
