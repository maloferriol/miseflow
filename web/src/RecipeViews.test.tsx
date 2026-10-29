import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { chickenStock, chickenStockWithYield, tarteTatin } from "../test/recipe-fixtures.ts";
import { renderView } from "../test/render-view.tsx";
import { yieldText } from "./recipe-screen.ts";
import {
  ExtractToSubRecipeView,
  type ExtractToSubRecipeViewProps,
  RecipeScreenView,
  type RecipeScreenViewProps,
  YieldFieldView,
  type YieldFieldViewProps,
} from "./RecipeViews.tsx";

function recipeScreenProps(overrides: Partial<RecipeScreenViewProps> = {}): RecipeScreenViewProps {
  return {
    recipe: { status: "success", data: tarteTatin },
    mode: "write",
    onMode: vi.fn(),
    selected: [],
    onSelect: vi.fn(),
    onUnselect: vi.fn(),
    onClearSelection: vi.fn(),
    adding: false,
    onAdding: vi.fn(),
    editPending: false,
    editError: null,
    onEdit: vi.fn(),
    movePending: false,
    moveError: null,
    onMove: vi.fn(),
    removePending: false,
    removeError: null,
    onRemove: vi.fn(),
    renderYield: () => <p>yield field</p>,
    renderPlanningPass: (recipe) => <p>Planning pass for {recipe.name}</p>,
    renderStep: (step) => <p>Step {step.id}</p>,
    renderNewStep: (onClose) => (
      <button type="button" onClick={onClose}>
        Close new Step
      </button>
    ),
    renderExtract: ({ stepIds, selected, onDone }) => (
      <button type="button" onClick={onDone}>
        Extract {selected.join(",")} of {stepIds.join(",")}
      </button>
    ),
    ...overrides,
  };
}

const button = (name: string) => screen.getByRole("button", { name });
const stepItems = () =>
  within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");

describe("Recipe screen view", () => {
  it("shows Loading while the Recipe loads", () => {
    renderView(<RecipeScreenView {...recipeScreenProps({ recipe: { status: "pending" } })} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("shows why the Recipe didn't load", () => {
    const error = new Error("Could not load the Recipe (500)");
    renderView(<RecipeScreenView {...recipeScreenProps({ recipe: { status: "error", error } })} />);
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Recipe (500)");
  });

  it("fills the Write mode's slots: the yield, each Step, Extract with the ticked Steps", () => {
    renderView(<RecipeScreenView {...recipeScreenProps({ selected: ["s-rest"] })} />);
    expect(screen.getByText("yield field")).toBeTruthy();
    expect(stepItems().map((li) => within(li).getByText(/^Step s-/).textContent)).toEqual([
      "Step s-rub",
      "Step s-rest",
      "Step s-caramelise",
    ]);
    expect(button("Extract s-rest of s-rub,s-rest,s-caramelise")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select Step 2" })).toHaveProperty("checked", true);
    expect(screen.getByRole("checkbox", { name: "Select Step 1" })).toHaveProperty(
      "checked",
      false,
    );
    expect(screen.queryByText(/Planning pass/)).toBeNull();
  });

  it("shows the Planning pass in Plan mode, with no Steps to edit", () => {
    renderView(<RecipeScreenView {...recipeScreenProps({ mode: "plan" })} />);
    expect(screen.getByText("Planning pass for Tarte tatin")).toBeTruthy();
    expect(button("Plan").getAttribute("aria-pressed")).toBe("true");
    expect(button("Write").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Step" })).toBeNull();
    // The ingredient list shows in both modes.
    expect(screen.getByRole("list", { name: "Ingredients" })).toBeTruthy();
  });

  it("asks for the mode the cook picks", () => {
    const onMode = vi.fn();
    renderView(<RecipeScreenView {...recipeScreenProps({ onMode })} />);
    fireEvent.click(button("Plan"));
    fireEvent.click(button("Write"));
    expect(onMode.mock.calls).toEqual([["plan"], ["write"]]);
  });

  it("sends the trimmed name and Servings, and nothing for a blank name", () => {
    const onEdit = vi.fn();
    renderView(<RecipeScreenView {...recipeScreenProps({ onEdit })} />);
    const name = screen.getByRole("textbox", { name: "Recipe name" });
    const servings = screen.getByRole("spinbutton", { name: "Servings" });

    fireEvent.change(servings, { target: { value: "" } });
    fireEvent.submit(name.closest("form")!);
    expect(onEdit).toHaveBeenLastCalledWith({ name: "Tarte tatin", servings: null });

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.submit(name.closest("form")!);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("disables Save Recipe while it saves, and shows a failed save", () => {
    renderView(
      <RecipeScreenView
        {...recipeScreenProps({ editPending: true, editError: new Error("Conflict (409)") })}
      />,
    );
    expect(button("Save Recipe")).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe("Conflict (409)");
  });

  it("asks to tick and untick a Step", () => {
    const onSelect = vi.fn();
    const onUnselect = vi.fn();
    renderView(
      <RecipeScreenView {...recipeScreenProps({ onSelect, onUnselect, selected: ["s-rub"] })} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 3" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Step 1" }));
    expect(onSelect.mock.calls).toEqual([["s-caramelise"]]);
    expect(onUnselect.mock.calls).toEqual([["s-rub"]]);
  });

  it("asks to move and remove a Step", () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    renderView(<RecipeScreenView {...recipeScreenProps({ onMove, onRemove })} />);
    const [rub, rest] = stepItems();

    fireEvent.click(within(rest).getByRole("button", { name: "Move up" }));
    fireEvent.click(within(rub).getByRole("button", { name: "Move down" }));
    expect(onMove.mock.calls).toEqual([
      [{ stepId: "s-rest", afterStepId: null }],
      [{ stepId: "s-rub", afterStepId: "s-rest" }],
    ]);
    fireEvent.click(within(rub).getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("s-rub");
  });

  it("disables every move while one is saving, and every remove while one is", () => {
    renderView(
      <RecipeScreenView {...recipeScreenProps({ movePending: true, removePending: true })} />,
    );
    const rest = stepItems()[1];
    expect(within(rest).getByRole("button", { name: "Move up" })).toHaveProperty("disabled", true);
    expect(within(rest).getByRole("button", { name: "Move down" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(rest).getByRole("button", { name: "Remove" })).toHaveProperty("disabled", true);
  });

  it("shows a failed move before a failed remove", () => {
    const { rerender } = renderView(
      <RecipeScreenView
        {...recipeScreenProps({
          moveError: new Error("Move failed"),
          removeError: new Error("Remove failed"),
        })}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Move failed");

    rerender(
      <RecipeScreenView {...recipeScreenProps({ removeError: new Error("Remove failed") })} />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Remove failed");
  });

  it("opens a new Step from Add Step, and closes it when the editor does", () => {
    const onAdding = vi.fn();
    const { rerender } = renderView(<RecipeScreenView {...recipeScreenProps({ onAdding })} />);
    fireEvent.click(button("Add Step"));
    expect(onAdding).toHaveBeenLastCalledWith(true);

    rerender(<RecipeScreenView {...recipeScreenProps({ onAdding, adding: true })} />);
    expect(screen.queryByRole("button", { name: "Add Step" })).toBeNull();
    fireEvent.click(button("Close new Step"));
    expect(onAdding).toHaveBeenLastCalledWith(false);
  });

  it("clears the ticks when Extract is done", () => {
    const onClearSelection = vi.fn();
    renderView(<RecipeScreenView {...recipeScreenProps({ onClearSelection })} />);
    fireEvent.click(button("Extract of s-rub,s-rest,s-caramelise"));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });
});

function yieldProps(overrides: Partial<YieldFieldViewProps> = {}): YieldFieldViewProps {
  return {
    recipe: chickenStockWithYield,
    savePending: false,
    saveError: null,
    onSave: vi.fn(),
    ...overrides,
  };
}

describe("Yield field view", () => {
  it("shows the saved yield", () => {
    renderView(<YieldFieldView {...yieldProps()} />);
    expect(screen.getByRole("textbox", { name: "Yield" })).toHaveProperty(
      "value",
      yieldText(chickenStockWithYield.yield),
    );
    expect(screen.queryByText("needs a yield")).toBeNull();
  });

  it("sends the trimmed yield, or null to clear it", () => {
    const onSave = vi.fn();
    renderView(<YieldFieldView {...yieldProps({ onSave })} />);
    const field = screen.getByRole("textbox", { name: "Yield" });

    fireEvent.change(field, { target: { value: " 2 L " } });
    fireEvent.click(button("Save yield"));
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.click(button("Save yield"));
    expect(onSave.mock.calls).toEqual([["2 L"], [null]]);
  });

  it("says a sub-recipe with no yield needs one, naming every Recipe that uses it", () => {
    const recipe = {
      ...chickenStock,
      usedBy: [...chickenStock.usedBy, { id: "r-duck", name: "Beurre blanc" }],
    };
    renderView(<YieldFieldView {...yieldProps({ recipe })} />);
    expect(screen.getByRole("textbox", { name: "Yield" })).toHaveProperty("value", "");
    expect(screen.getByText(/used as a sub-recipe by/).textContent).toBe(
      "needs a yield: used as a sub-recipe by Velouté, Beurre blanc",
    );
  });

  it("disables Save yield while it saves, and shows a failed save", () => {
    renderView(
      <YieldFieldView
        {...yieldProps({ savePending: true, saveError: new Error("Not a yield: 1-2 L") })}
      />,
    );
    expect(button("Save yield")).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe("Not a yield: 1-2 L");
  });
});

const stepIds = tarteTatin.steps.map((s) => s.id);

function extractProps(
  overrides: Partial<ExtractToSubRecipeViewProps> = {},
): ExtractToSubRecipeViewProps {
  return {
    stepIds,
    selected: ["s-rest", "s-rub"],
    name: "Pastry",
    amount: "1",
    onName: vi.fn(),
    onAmount: vi.fn(),
    extractPending: false,
    extractError: null,
    onExtract: vi.fn(),
    ...overrides,
  };
}

const extractButton = () => button("Extract to sub-recipe");

describe("Extract to sub-recipe view", () => {
  it("extracts the ticked Steps in Step order, with the trimmed name and amount", () => {
    const onExtract = vi.fn();
    renderView(
      <ExtractToSubRecipeView
        {...extractProps({ name: " Pastry ", amount: " 500%g ", onExtract })}
      />,
    );
    fireEvent.click(extractButton());
    expect(onExtract).toHaveBeenCalledWith({
      stepIds: ["s-rub", "s-rest"],
      name: "Pastry",
      amount: "500%g",
    });
  });

  it("extracts an amount of 1 when the amount is blank", () => {
    const onExtract = vi.fn();
    renderView(<ExtractToSubRecipeView {...extractProps({ amount: "", onExtract })} />);
    fireEvent.click(extractButton());
    expect(onExtract).toHaveBeenCalledWith({
      stepIds: ["s-rub", "s-rest"],
      name: "Pastry",
      amount: "1",
    });
  });

  it("passes on what the cook types", () => {
    const onName = vi.fn();
    const onAmount = vi.fn();
    renderView(<ExtractToSubRecipeView {...extractProps({ onName, onAmount })} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name for the sub-recipe" }), {
      target: { value: "Pâte brisée" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Amount used" }), {
      target: { value: "2" },
    });
    expect(onName).toHaveBeenCalledWith("Pâte brisée");
    expect(onAmount).toHaveBeenCalledWith("2");
  });

  it("can't extract without a name", () => {
    renderView(<ExtractToSubRecipeView {...extractProps({ name: "  " })} />);
    expect(extractButton()).toHaveProperty("disabled", true);
  });

  it("can't extract before a Step is ticked, and says nothing yet", () => {
    renderView(<ExtractToSubRecipeView {...extractProps({ selected: [] })} />);
    expect(extractButton()).toHaveProperty("disabled", true);
    expect(screen.queryByText("Select Steps that follow one another.")).toBeNull();
  });

  it("can't extract Steps with a gap, and asks for Steps that follow one another", () => {
    const onExtract = vi.fn();
    renderView(
      <ExtractToSubRecipeView
        {...extractProps({ selected: ["s-rub", "s-caramelise"], onExtract })}
      />,
    );
    expect(extractButton()).toHaveProperty("disabled", true);
    expect(screen.getByText("Select Steps that follow one another.")).toBeTruthy();
  });

  it("disables Extract while it saves, and shows a failed extract", () => {
    renderView(
      <ExtractToSubRecipeView
        {...extractProps({
          extractPending: true,
          extractError: new Error("Steps not consecutive"),
        })}
      />,
    );
    expect(extractButton()).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe("Steps not consecutive");
  });
});
