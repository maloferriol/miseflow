import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import { MenuListView, NewMenuView, type NewMenuViewProps } from "./MenuViews.tsx";

const button = (name: string) => screen.getByRole("button", { name });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Menu list", () => {
  it("shows Loading… while the Menus load", () => {
    renderView(<MenuListView menus={{ status: "pending" }} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows a failed load as an alert with its message", () => {
    renderView(
      <MenuListView
        menus={{ status: "error", error: new Error("Could not load the Menus (500)") }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Menus (500)");
  });

  it("shows no list while there are no Menus", () => {
    renderView(<MenuListView menus={{ status: "success", data: [] }} />);
    expect(screen.queryByRole("navigation", { name: "Your Menus" })).toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("links each Menu to its page", () => {
    renderView(
      <MenuListView
        menus={{ status: "success", data: [{ id: "m-1", name: "Saturday dinner" }] }}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Your Menus" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Saturday dinner" }).getAttribute("href")).toBe(
      "?menu=m-1",
    );
  });
});

describe("New Menu", () => {
  const newMenu = (props: Partial<NewMenuViewProps> = {}) =>
    renderView(
      <NewMenuView createPending={false} createError={null} onCreate={() => {}} {...props} />,
    );

  it("creates a Menu from its name and Guests", () => {
    const onCreate = vi.fn();
    newMenu({ onCreate });
    type("Menu name", "Saturday dinner");
    type("Guests", "6");
    fireEvent.click(button("Create Menu"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Saturday dinner", guestCount: 6 });
  });

  it("disables Create Menu while a create is pending", () => {
    newMenu({ createPending: true });
    expect(button("Create Menu").hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed create as an alert with its message", () => {
    newMenu({ createError: new Error("Could not create the Menu (500)") });
    expect(screen.getByRole("alert").textContent).toBe("Could not create the Menu (500)");
  });
});
