import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import { type Screen, screenFor } from "./app-shell.ts";
import { AppView, type AppViewProps } from "./AppView.tsx";

const signedInProps = (overrides: Partial<AppViewProps> = {}): AppViewProps => ({
  signedIn: true,
  view: "menu",
  screen: screenFor({ view: "menu", session: {}, recipeId: null, serviceId: null }),
  onOpen: vi.fn(),
  onSignOut: vi.fn(),
  renderScreen: (s: Screen) => <p>Screen: {s.name}</p>,
  ...overrides,
});

describe("the app shell's view", () => {
  it("shows the screen it is given under the header", () => {
    renderView(<AppView {...signedInProps()} />);
    expect(screen.getByRole("heading", { name: "MiseFlow" })).toBeTruthy();
    expect(screen.getByText("Screen: menu")).toBeTruthy();
  });

  it("shows no nav and no Sign out when signed out", () => {
    renderView(
      <AppView
        {...signedInProps({
          signedIn: false,
          screen: screenFor({ view: "menu", session: null, recipeId: null, serviceId: null }),
        })}
      />,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.getByText("Screen: signIn")).toBeTruthy();
  });

  it("presses Recipes while a Recipe is open", () => {
    renderView(<AppView {...signedInProps({ view: "recipe" })} />);
    const pressed = screen
      .getAllByRole("button", { pressed: true })
      .map((button) => button.textContent);
    expect(pressed).toEqual(["Recipes"]);
  });

  it.each([
    ["Menu", "menu"],
    ["Recipes", "recipes"],
    ["Catalog", "catalog"],
    ["Availability", "availability"],
  ])("opens the %s from the nav", (label, view) => {
    const props = signedInProps({ view: "today" });
    renderView(<AppView {...props} />);
    expect(screen.getByRole("button", { name: label, pressed: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(props.onOpen).toHaveBeenCalledWith(view);
  });

  it("signs out from the header", () => {
    const props = signedInProps();
    renderView(<AppView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(props.onSignOut).toHaveBeenCalledOnce();
  });
});
