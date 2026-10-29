import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { planningRecipe } from "../test/planning-recipe.ts";
import { renderView } from "../test/render-view.tsx";
import type { Recipe } from "./api.ts";
import { PlanningPassView, type PlanningPassViewProps } from "./PlanningPassView.tsx";

// ADR 0004's chicken stock: "made 3 days ahead and keeps 4".
const stockWindow = { beforeDays: 3, shelfLifeDays: 4 };

const roast = { id: "s-roast", text: "Roast the bones" };
const simmer = { id: "s-simmer", text: "Simmer for four hours" };
const strain = { id: "s-strain", text: "Strain and cool" };

function renderPass(recipe: Recipe, props: Partial<PlanningPassViewProps> = {}) {
  const all: PlanningPassViewProps = {
    recipe,
    windowPending: false,
    error: null,
    onRecipeWindow: vi.fn(),
    onStepTimes: vi.fn(),
    onStepWindow: vi.fn(),
    onGroup: vi.fn(),
    onAddLink: vi.fn(),
    onRemoveLink: vi.fn(),
    ...props,
  };
  const view = renderView(<PlanningPassView {...all} />);
  return {
    ...all,
    rerender: (next: Recipe) => view.rerender(<PlanningPassView {...all} recipe={next} />),
  };
}

const recipeWindow = () =>
  screen.getByRole("button", { name: "Save window" }).closest("form") as HTMLFormElement;
// The Steps' rows, not the links listed inside them.
const rows = () => {
  const list = screen.getByRole("list", { name: "Planning" });
  return within(list)
    .getAllByRole("listitem")
    .filter((item) => item.parentElement === list);
};
const row = (index: number) => within(rows()[index]);
const ownWindow = (index: number) =>
  row(index).getByRole<HTMLInputElement>("checkbox", { name: "Own make-ahead window" });
const groupBox = (index: number) =>
  row(index).getByRole<HTMLInputElement>("checkbox", { name: "Group with previous Step" });
const fill = (
  scope: Pick<ReturnType<typeof row>, "getByLabelText">,
  label: string,
  value: string,
) => fireEvent.change(scope.getByLabelText(label), { target: { value } });

describe("Planning pass view: Ready to plan", () => {
  it("lists the Steps still missing a duration, linked to their rows", () => {
    renderPass(planningRecipe({ steps: [{ ...roast, activeMinutes: 20 }, simmer] }));
    const ready = screen.getByRole("list", { name: "Ready to plan" });
    const link = within(ready).getByRole("link", {
      name: "Step 2 · Simmer for four hours has no duration",
    });
    expect(link.getAttribute("href")).toBe("#plan-step-s-simmer");
    expect(rows()[1].id).toBe("plan-step-s-simmer");
  });
});

describe("Planning pass view: the Recipe's window", () => {
  it("shows the saved window and saves what the cook types", () => {
    const { onRecipeWindow } = renderPass(
      planningRecipe({ makeAhead: stockWindow, steps: [roast] }),
    );
    const form = within(recipeWindow());
    expect(form.getByLabelText<HTMLInputElement>("Days ahead").value).toBe("3");
    expect(form.getByLabelText<HTMLInputElement>("Shelf life (days)").value).toBe("4");

    fill(form, "Days ahead", "2");
    fill(form, "Shelf life (days)", "5");
    fireEvent.click(form.getByRole("button", { name: "Save window" }));
    expect(onRecipeWindow).toHaveBeenCalledExactlyOnceWith({ beforeDays: 2, shelfLifeDays: 5 });
  });

  it("clears a saved window", () => {
    const { onRecipeWindow } = renderPass(
      planningRecipe({ makeAhead: stockWindow, steps: [roast] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onRecipeWindow).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("opens with empty fields and Clear off when the Recipe has no window", () => {
    renderPass(planningRecipe({ steps: [roast] }));
    const form = within(recipeWindow());
    expect(form.getByLabelText<HTMLInputElement>("Days ahead").value).toBe("");
    expect(form.getByLabelText<HTMLInputElement>("Shelf life (days)").value).toBe("");
    expect(form.getByRole<HTMLButtonElement>("button", { name: "Clear" }).disabled).toBe(true);
    expect(form.getByRole<HTMLButtonElement>("button", { name: "Save window" }).disabled).toBe(
      false,
    );
  });

  it("turns Save window and Clear off while a window save is pending", () => {
    renderPass(planningRecipe({ makeAhead: stockWindow, steps: [roast] }), { windowPending: true });
    const form = within(recipeWindow());
    expect(form.getByRole<HTMLButtonElement>("button", { name: "Save window" }).disabled).toBe(
      true,
    );
    expect(form.getByRole<HTMLButtonElement>("button", { name: "Clear" }).disabled).toBe(true);
  });

  it("shows the saved values again once a new Revision arrives", () => {
    const { rerender } = renderPass(planningRecipe({ steps: [roast] }));
    fill(within(recipeWindow()), "Days ahead", "9");
    rerender(planningRecipe({ makeAhead: stockWindow, latestRevision: 8, steps: [roast] }));
    expect(within(recipeWindow()).getByLabelText<HTMLInputElement>("Days ahead").value).toBe("3");
  });
});

describe("Planning pass view: errors", () => {
  it("shows a failed save's error", () => {
    renderPass(planningRecipe({ steps: [roast] }), {
      error: new Error("Could not save (409)"),
    });
    expect(screen.getByRole("alert").textContent).toBe("Could not save (409)");
  });

  it("shows no alert when nothing failed", () => {
    renderPass(planningRecipe({ steps: [roast] }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Planning pass view: a Step's times", () => {
  it("shows each Step's label and saved times, and saves the times typed", () => {
    const { onStepTimes } = renderPass(
      planningRecipe({ steps: [{ ...roast, activeMinutes: 20, passiveMinutes: 60 }, simmer] }),
    );
    expect(row(0).getByText("Step 1 · Roast the bones")).toBeTruthy();
    expect(row(0).getByLabelText<HTMLInputElement>("Active minutes").value).toBe("20");
    expect(row(0).getByLabelText<HTMLInputElement>("Passive minutes").value).toBe("60");
    expect(row(1).getByLabelText<HTMLInputElement>("Active minutes").value).toBe("");

    fill(row(1), "Active minutes", "5");
    fill(row(1), "Passive minutes", "240");
    fireEvent.click(row(1).getByRole("button", { name: "Save times" }));
    expect(onStepTimes).toHaveBeenCalledExactlyOnceWith("s-simmer", {
      activeMinutes: 5,
      passiveMinutes: 240,
    });
  });

  it("saves an emptied field as no time", () => {
    const { onStepTimes } = renderPass(
      planningRecipe({ steps: [{ ...roast, activeMinutes: 20, passiveMinutes: 60 }] }),
    );
    fill(row(0), "Passive minutes", "");
    fireEvent.click(row(0).getByRole("button", { name: "Save times" }));
    expect(onStepTimes).toHaveBeenCalledExactlyOnceWith("s-roast", {
      activeMinutes: 20,
      passiveMinutes: null,
    });
  });
});

describe("Planning pass view: a Step's own window", () => {
  it("shows Last-minute for a Step with no window anywhere", () => {
    renderPass(planningRecipe({ steps: [roast] }));
    expect(ownWindow(0).checked).toBe(false);
    expect(row(0).getByText("Last-minute")).toBeTruthy();
    expect(row(0).queryByLabelText("Days ahead")).toBeNull();
  });

  it("shows the Recipe's window a Step inherits", () => {
    renderPass(planningRecipe({ makeAhead: stockWindow, steps: [roast] }));
    expect(row(0).getByText("Inherits 3 days ahead · keeps 4 days")).toBeTruthy();
  });

  it("opens ticked with the saved window, and saves what the cook types", () => {
    const { onStepWindow } = renderPass(
      planningRecipe({ steps: [{ ...roast, makeAhead: stockWindow }] }),
    );
    expect(ownWindow(0).checked).toBe(true);
    expect(row(0).getByLabelText<HTMLInputElement>("Days ahead").value).toBe("3");
    expect(row(0).getByLabelText<HTMLInputElement>("Shelf life (days)").value).toBe("4");

    fill(row(0), "Days ahead", "1");
    fireEvent.click(row(0).getByRole("button", { name: "Save" }));
    expect(onStepWindow).toHaveBeenCalledExactlyOnceWith("s-roast", {
      beforeDays: 1,
      shelfLifeDays: 4,
    });
  });

  it("ticking shows empty fields and saves nothing until Save", () => {
    const { onStepWindow } = renderPass(planningRecipe({ makeAhead: stockWindow, steps: [roast] }));
    fireEvent.click(ownWindow(0));
    expect(ownWindow(0).checked).toBe(true);
    expect(row(0).getByLabelText<HTMLInputElement>("Days ahead").value).toBe("");
    expect(row(0).queryByText("Inherits 3 days ahead · keeps 4 days")).toBeNull();
    expect(onStepWindow).not.toHaveBeenCalled();

    fill(row(0), "Days ahead", "0");
    fill(row(0), "Shelf life (days)", "1");
    fireEvent.click(row(0).getByRole("button", { name: "Save" }));
    expect(onStepWindow).toHaveBeenCalledExactlyOnceWith("s-roast", {
      beforeDays: 0,
      shelfLifeDays: 1,
    });
  });

  it("unticking a window never saved sends nothing and shows the inherited window again", () => {
    const { onStepWindow } = renderPass(planningRecipe({ makeAhead: stockWindow, steps: [roast] }));
    fireEvent.click(ownWindow(0));
    fireEvent.click(ownWindow(0));
    expect(ownWindow(0).checked).toBe(false);
    expect(row(0).getByText("Inherits 3 days ahead · keeps 4 days")).toBeTruthy();
    expect(onStepWindow).not.toHaveBeenCalled();
  });

  it("unticking a saved window clears it", () => {
    const { onStepWindow } = renderPass(
      planningRecipe({ steps: [{ ...roast, makeAhead: stockWindow }] }),
    );
    fireEvent.click(ownWindow(0));
    expect(onStepWindow).toHaveBeenCalledExactlyOnceWith("s-roast", null);
    expect(ownWindow(0).checked).toBe(false);
  });

  it("opens unticked again once a new Revision arrives without the window", () => {
    const { rerender } = renderPass(planningRecipe({ steps: [roast] }));
    fireEvent.click(ownWindow(0));
    rerender(planningRecipe({ latestRevision: 8, steps: [roast] }));
    expect(ownWindow(0).checked).toBe(false);
    expect(row(0).getByText("Last-minute")).toBeTruthy();
  });
});

describe("Planning pass view: grouping", () => {
  it("turns the box off for the first Step, ticked or not", () => {
    renderPass(planningRecipe({ steps: [{ ...roast, groupWithPrevious: true }, simmer] }));
    expect(groupBox(0).disabled).toBe(true);
    expect(groupBox(0).checked).toBe(false);
    expect(groupBox(1).disabled).toBe(false);
    expect(groupBox(1).checked).toBe(false);
  });

  it("groups a later Step with the previous one", () => {
    const { onGroup } = renderPass(planningRecipe({ steps: [roast, simmer] }));
    fireEvent.click(groupBox(1));
    expect(onGroup).toHaveBeenCalledExactlyOnceWith("s-simmer", true);
  });

  it("shows a grouped Step ticked, and ungroups it", () => {
    const { onGroup } = renderPass(
      planningRecipe({ steps: [roast, { ...simmer, groupWithPrevious: true }] }),
    );
    expect(groupBox(1).checked).toBe(true);
    fireEvent.click(groupBox(1));
    expect(onGroup).toHaveBeenCalledExactlyOnceWith("s-simmer", false);
  });
});

describe("Planning pass view: links", () => {
  const linked = () =>
    planningRecipe({
      steps: [roast, simmer, strain],
      dependencies: [{ id: "d-1", beforeStepId: "s-roast", afterStepId: "s-strain" }],
    });

  it("offers every other Step to wait for", () => {
    renderPass(linked());
    const options = row(1)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "Choose a Step",
      "Step 1 · Roast the bones",
      "Step 3 · Strain and cool",
    ]);
  });

  it("adds a link to the Step chosen", () => {
    const { onAddLink } = renderPass(linked());
    fireEvent.change(row(1).getByRole("combobox", { name: "Waits for" }), {
      target: { value: "s-roast" },
    });
    fireEvent.click(row(1).getByRole("button", { name: "Add" }));
    expect(onAddLink).toHaveBeenCalledExactlyOnceWith("s-simmer", "s-roast");
  });

  it("adds nothing when no Step is chosen", () => {
    const { onAddLink } = renderPass(linked());
    fireEvent.click(row(1).getByRole("button", { name: "Add" }));
    expect(onAddLink).not.toHaveBeenCalled();
  });

  it("lists what a Step waits for and removes a link by its id", () => {
    const { onRemoveLink } = renderPass(linked());
    expect(row(0).queryByRole("list", { name: "Waits for" })).toBeNull();
    const waits = within(row(2).getByRole("list", { name: "Waits for" }));
    expect(waits.getByRole("listitem").textContent).toContain("Step 1 · Roast the bones");
    fireEvent.click(waits.getByRole("button", { name: "Remove" }));
    expect(onRemoveLink).toHaveBeenCalledExactlyOnceWith("d-1");
  });
});
