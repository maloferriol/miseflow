import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import type { ShoppingList, ShoppingRow } from "./api.ts";
import { needText } from "./need.ts";
import { missingText } from "./shopping-list.ts";
import { ShoppingListView, ShoppingRowView } from "./ShoppingListViews.tsx";

const row = (spec: Partial<ShoppingRow> & Pick<ShoppingRow, "ingredientId" | "name">) => ({
  need: null,
  unit: null,
  approximate: false,
  vague: [],
  unconverted: [],
  got: false,
  ...spec,
});

// Rows as the walkthrough's Shopping list holds them (e2e/shopping.spec.ts).
const apple = row({ ingredientId: "i-apple", name: "apple", need: 6, unit: "each" });
const shallot = row({ ingredientId: "i-shallot", name: "shallot", need: 150, unit: "g" });
const butter = row({ ingredientId: "i-butter", name: "butter", need: 300, unit: "g", got: true });
const salt = row({ ingredientId: "i-salt", name: "salt", vague: ["a pinch"] });

const walkthrough: ShoppingList = {
  service: { id: "s-1", menuId: "m-1" },
  categories: [
    { id: "c-produce", name: "Produce", rows: [apple, shallot] },
    { id: "c-dairy", name: "Dairy & eggs", rows: [butter] },
    { id: null, name: "No category", rows: [salt] },
  ],
  missing: [],
};

const loaded = (data: ShoppingList) => ({ status: "success" as const, data });
const names = (rows: ShoppingRow[]) => rows.map((r) => r.name);

afterEach(() => vi.restoreAllMocks());

describe("Shopping list", () => {
  it("shows Loading… while the list loads", () => {
    renderView(<ShoppingListView list={{ status: "pending" }} renderRow={() => null} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Shopping list" })).toBeNull();
  });

  it("shows a failed load as an alert with its message", () => {
    renderView(
      <ShoppingListView
        list={{ status: "error", error: new Error("Could not load the Shopping list (500)") }}
        renderRow={() => null}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Shopping list (500)");
  });

  it("says there is nothing to buy when no category has rows", () => {
    renderView(
      <ShoppingListView list={loaded({ ...walkthrough, categories: [] })} renderRow={() => null} />,
    );
    expect(screen.getByRole("heading", { name: "Shopping list" })).toBeTruthy();
    expect(screen.getByText("Nothing to buy")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("links back to the Service's Menu", () => {
    renderView(<ShoppingListView list={loaded(walkthrough)} renderRow={() => null} />);
    expect(screen.getByRole("link", { name: "Back to the Menu" }).getAttribute("href")).toBe(
      "?menu=m-1",
    );
  });

  it("groups the rows under each category in the list's order", () => {
    renderView(
      <ShoppingListView list={loaded(walkthrough)} renderRow={(r) => <li>{r.name}</li>} />,
    );
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Produce",
      "Dairy & eggs",
      "No category",
    ]);
    for (const category of walkthrough.categories) {
      const items = within(screen.getByRole("list", { name: category.name })).getAllByRole(
        "listitem",
      );
      expect(items.map((li) => li.textContent)).toEqual(names(category.rows));
    }
    expect(screen.queryByText("Nothing to buy")).toBeNull();
  });

  it("prints the page", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderView(<ShoppingListView list={loaded(walkthrough)} renderRow={() => null} />);
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("lists the Missing sub-recipes on top", () => {
    const missing = [
      { lineId: "l-1", recipeName: "Velouté", wording: "chicken stock" },
      { lineId: "l-2", recipeName: "Tarte tatin", wording: null },
    ];
    renderView(
      <ShoppingListView list={loaded({ ...walkthrough, missing })} renderRow={() => null} />,
    );
    const items = within(screen.getByRole("list", { name: "Missing sub-recipes" })).getAllByRole(
      "listitem",
    );
    expect(items.map((li) => li.textContent)).toEqual(missing.map(missingText));
  });

  it("shows no Missing sub-recipes list when there are none", () => {
    renderView(<ShoppingListView list={loaded(walkthrough)} renderRow={() => null} />);
    expect(screen.queryByRole("list", { name: "Missing sub-recipes" })).toBeNull();
  });
});

describe("Shopping row", () => {
  const rowView = (props: Partial<Parameters<typeof ShoppingRowView>[0]> = {}) =>
    renderView(
      <ul>
        <ShoppingRowView
          row={butter}
          checked={false}
          tickError={null}
          onTick={() => {}}
          {...props}
        />
      </ul>,
    );

  it("labels its tick box with the Ingredient and writes its need", () => {
    rowView();
    expect(screen.getByRole("checkbox", { name: "butter" })).toBeTruthy();
    expect(screen.getByRole("listitem").textContent?.trim()).toBe(`butter ${needText(butter)}`);
  });

  it("shows the box as the hook says, not as the row was saved", () => {
    rowView({ row: butter, checked: false });
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "butter" }).checked).toBe(false);
  });

  it("ticks Got and un-ticks", () => {
    const onTick = vi.fn();
    rowView({ checked: false, onTick });
    fireEvent.click(screen.getByRole("checkbox", { name: "butter" }));
    expect(onTick).toHaveBeenLastCalledWith(true);

    rowView({ row: shallot, checked: true, onTick });
    fireEvent.click(screen.getByRole("checkbox", { name: "shallot" }));
    expect(onTick).toHaveBeenLastCalledWith(false);
  });

  it("shows a failed tick as an alert with its message", () => {
    rowView({ tickError: new Error("Could not save (500)") });
    expect(screen.getByRole("alert").textContent).toBe(" Could not save (500)");
  });

  it("shows no alert while the tick hasn't failed", () => {
    rowView();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
