import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderView } from "../test/render-view.tsx";
import { MenuListView } from "./MenuViews.tsx";

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
