import { describe, expect, it } from "vitest";
import { openedUrl, screenFor, viewFromSearch } from "./app-shell.ts";

describe("the view a link names", () => {
  it.each([
    ["", "menu"],
    ["?view=nonsense", "menu"],
    ["?view=catalog", "catalog"],
    ["?view=recipes", "recipes"],
    ["?view=recipe&recipe=r-veloute", "recipe"],
    ["?view=availability", "availability"],
    ["?view=plan&service=s-saturday", "plan"],
    ["?view=today&service=s-saturday&day=2026-10-30", "today"],
    ["?view=shopping&service=s-saturday", "shopping"],
  ])("%j opens %s", (search, view) => {
    expect(viewFromSearch(search)).toBe(view);
  });

  it("opens the Recipes list for a Recipe link with no Recipe", () => {
    expect(viewFromSearch("?view=recipe")).toBe("recipes");
  });

  it.each(["plan", "today", "shopping"])("opens the Menu for a %s link with no Service", (view) => {
    expect(viewFromSearch(`?view=${view}`)).toBe("menu");
  });
});

describe("the screen for the link and the session", () => {
  const session = { access_token: "a-token" };
  const ids = { recipeId: "r-veloute", serviceId: "s-saturday" };

  it("shows nothing while the session is still being read", () => {
    expect(screenFor({ view: "catalog", session: undefined, ...ids })).toEqual({
      name: "checking",
    });
  });

  it("shows sign-in when the cook is signed out, whatever the link names", () => {
    expect(screenFor({ view: "recipe", session: null, ...ids })).toEqual({ name: "signIn" });
  });

  it.each(["menu", "catalog", "recipes", "availability"] as const)("shows the %s", (view) => {
    expect(screenFor({ view, session, ...ids })).toEqual({ name: view });
  });

  it("shows the Recipe the link names", () => {
    expect(screenFor({ view: "recipe", session, ...ids })).toEqual({
      name: "recipe",
      recipeId: "r-veloute",
    });
  });

  it.each(["plan", "today", "shopping"] as const)("shows the %s of the Service", (view) => {
    expect(screenFor({ view, session, ...ids })).toEqual({ name: view, serviceId: "s-saturday" });
  });

  it("shows the Menu for a Recipe view with no Recipe", () => {
    expect(screenFor({ view: "recipe", session, recipeId: null, serviceId: null })).toEqual({
      name: "menu",
    });
  });

  it.each(["plan", "today", "shopping"] as const)(
    "shows the Menu for a %s view with no Service",
    (view) => {
      expect(screenFor({ view, session, recipeId: null, serviceId: null })).toEqual({
        name: "menu",
      });
    },
  );
});

describe("the link after opening a view", () => {
  const at = (search: string) => ({ search, pathname: "/" });

  it("names the view and keeps the open Menu", () => {
    expect(openedUrl(at("?menu=m-dinner"), "catalog")).toBe("?menu=m-dinner&view=catalog");
  });

  it("names the Recipe it opens", () => {
    expect(openedUrl(at("?view=recipes"), "recipe", "r-veloute")).toBe(
      "?view=recipe&recipe=r-veloute",
    );
  });

  it("drops the Service, the day and the last Recipe", () => {
    expect(
      openedUrl(at("?view=today&service=s-saturday&day=2026-10-30&recipe=r-veloute"), "recipes"),
    ).toBe("?view=recipes");
  });

  it("leaves only the path when it opens the Menu with nothing else in the link", () => {
    expect(openedUrl({ search: "?view=catalog", pathname: "/app" }, "menu")).toBe("/app");
  });
});
