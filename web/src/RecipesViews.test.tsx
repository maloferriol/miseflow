import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecipesView, type RecipesViewProps } from "./RecipesViews.tsx";

// ADR 0004's Recipes.
const walkthrough = [
  { id: "r-stock", name: "Chicken stock" },
  { id: "r-veloute", name: "Velouté" },
];

// A loaded list with nothing pending; each test sets what it checks.
function recipesView(props: Partial<RecipesViewProps> = {}) {
  return (
    <RecipesView
      recipes={{ data: walkthrough, error: null }}
      createPending={false}
      createError={null}
      onCreate={vi.fn()}
      onOpen={vi.fn()}
      {...props}
    />
  );
}

const list = () => screen.getByRole("list", { name: "Recipes" });
const nameField = () => screen.getByRole("textbox", { name: "Recipe name" });
const create = () => screen.getByRole("button", { name: "Create Recipe" });

describe("Recipes view", () => {
  it("lists each Recipe by name as a link to it", () => {
    render(recipesView());
    const links = within(list()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Chicken stock", "Velouté"]);
    expect(links[1].getAttribute("href")).toBe("?view=recipe&recipe=r-veloute");
  });

  it("opens a Recipe in the app when its link is clicked, without following the link", () => {
    const onOpen = vi.fn();
    render(recipesView({ onOpen }));
    const followed = fireEvent.click(screen.getByRole("link", { name: "Velouté" }));
    expect(onOpen).toHaveBeenCalledWith("r-veloute");
    expect(followed).toBe(false);
  });

  it("says it is loading, and keeps the New Recipe form, while the Recipes load", () => {
    render(recipesView({ recipes: { data: undefined, error: null } }));
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(within(list()).queryAllByRole("listitem")).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(create()).toHaveProperty("disabled", false);
  });

  it("says the kitchen has no Recipes yet", () => {
    render(recipesView({ recipes: { data: [], error: null } }));
    expect(screen.getByText("No Recipes yet")).toBeTruthy();
    expect(within(list()).queryAllByRole("listitem")).toEqual([]);
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("says neither loading nor empty once the Recipes are listed", () => {
    render(recipesView());
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.queryByText("No Recipes yet")).toBeNull();
  });

  it("shows why the Recipes didn't load", () => {
    const error = new Error("Could not load the Recipes (500)");
    render(recipesView({ recipes: { data: undefined, error } }));
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Recipes (500)");
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("creates a Recipe with the trimmed name the cook typed", () => {
    const onCreate = vi.fn();
    render(recipesView({ onCreate }));
    fireEvent.change(nameField(), { target: { value: "  Tarte tatin " } });
    fireEvent.click(create());
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("Tarte tatin");
  });

  it("creates nothing for a blank name", () => {
    const onCreate = vi.fn();
    render(recipesView({ onCreate }));
    fireEvent.change(nameField(), { target: { value: "   " } });
    fireEvent.submit(create().closest("form")!);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("disables Create while a create is pending, and shows why one failed", () => {
    const view = render(recipesView({ createPending: true }));
    expect(create()).toHaveProperty("disabled", true);

    view.rerender(recipesView({ createError: new Error("Could not save (500)") }));
    expect(create()).toHaveProperty("disabled", false);
    expect(screen.getByRole("alert").textContent).toBe("Could not save (500)");
  });
});
