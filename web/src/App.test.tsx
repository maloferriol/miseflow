import type { AuthChangeEvent, AuthError, Session, User } from "@supabase/supabase-js";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWired } from "../test/render-view.tsx";
import { walkthroughPlan } from "../test/walkthrough-plan.ts";
import {
  fetchAvailability,
  fetchIngredients,
  fetchMenu,
  fetchMenus,
  fetchPlan,
  fetchRecipe,
  fetchRecipes,
  fetchShoppingCategories,
  fetchShoppingList,
  type RecipeListItem,
} from "./api.ts";
import { App } from "./App.tsx";
import { supabase } from "./supabase.ts";

// The network boundary only: the screens' queries run through a real QueryClient.
vi.mock("./api.ts", () => ({
  fetchAvailability: vi.fn(),
  fetchIngredients: vi.fn(),
  fetchMenu: vi.fn(),
  fetchMenus: vi.fn(),
  fetchPlan: vi.fn(),
  fetchRecipe: vi.fn(),
  fetchRecipes: vi.fn(),
  fetchShoppingCategories: vi.fn(),
  fetchShoppingList: vi.fn(),
  mutate: vi.fn(),
}));

// The auth boundary (ADR 0011): the shell and sign-in talk to Supabase auth directly.
vi.mock("./supabase.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const auth = vi.mocked(supabase.auth);
const unsubscribe = vi.fn();

// The cook's session, as far as the shell reads it: only whether there is one.
const session = { access_token: "a-token" } as Session;

type SessionResult = Awaited<ReturnType<typeof auth.getSession>>;
type SignInResult = Awaited<ReturnType<typeof auth.signInWithPassword>>;

function signedIn(): SessionResult {
  return { data: { session }, error: null };
}
function signedOut(): SessionResult {
  return { data: { session: null }, error: null };
}

/** Tells the shell's listener that the session changed, as Supabase does. */
function authChange(event: AuthChangeEvent, next: Session | null) {
  const listener = auth.onAuthStateChange.mock.calls.at(-1)?.[0];
  if (!listener) throw new Error("No auth listener");
  return act(() => listener(event, next));
}

// A read that never answers: the test only checks which screen asked for what.
const never = () => new Promise<never>(() => {});

const velouté = { id: "r-veloute", name: "Velouté" } as RecipeListItem;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  auth.getSession.mockReset().mockResolvedValue(signedIn());
  unsubscribe.mockReset();
  auth.onAuthStateChange
    .mockReset()
    .mockReturnValue({ data: { subscription: { unsubscribe } } } as never);
  auth.signInWithPassword.mockReset();
  auth.signOut.mockReset().mockResolvedValue({ error: null });
  for (const read of [
    fetchAvailability,
    fetchIngredients,
    fetchMenu,
    fetchMenus,
    fetchRecipe,
    fetchShoppingCategories,
    fetchShoppingList,
  ])
    vi.mocked(read).mockReset().mockImplementation(never);
  vi.mocked(fetchRecipes).mockReset().mockResolvedValue([velouté]);
  vi.mocked(fetchPlan).mockReset().mockResolvedValue(walkthroughPlan());
});

describe("the app shell", () => {
  it("shows neither sign-in nor a screen while it reads the session", () => {
    auth.getSession.mockImplementation(never);
    renderWired(<App />);
    expect(screen.getByRole("heading", { name: "MiseFlow" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(fetchMenus).not.toHaveBeenCalled();
  });

  it("shows sign-in, whatever the link names, when the cook is signed out", async () => {
    window.history.replaceState(null, "", "/?view=catalog");
    auth.getSession.mockResolvedValue(signedOut());
    renderWired(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(fetchIngredients).not.toHaveBeenCalled();
  });

  it.each([
    ["/", "the Menus", () => expect(fetchMenus).toHaveBeenCalled()],
    ["/?view=catalog", "the catalog", () => expect(fetchIngredients).toHaveBeenCalledWith("")],
    ["/?view=recipes", "the Recipes", () => expect(fetchRecipes).toHaveBeenCalled()],
    [
      "/?view=recipe&recipe=r-veloute",
      "the Recipe",
      () => expect(fetchRecipe).toHaveBeenCalledWith("r-veloute"),
    ],
    [
      "/?view=availability",
      "the Availability",
      () => {
        expect(fetchAvailability).toHaveBeenCalled();
        expect(fetchMenus).not.toHaveBeenCalled();
      },
    ],
    [
      "/?view=plan&service=s-saturday",
      "the Service's Plan",
      () => {
        expect(fetchPlan).toHaveBeenCalledWith("s-saturday");
        // The Plan screen heads its Plan; only the Today checklist has a tab per prep day.
        expect(screen.getByRole("heading", { name: /^Plan for/ })).toBeTruthy();
        expect(screen.queryByRole("tablist", { name: "Prep days" })).toBeNull();
      },
    ],
    [
      "/?view=today&service=s-saturday",
      "the Service's Plan for Today",
      () => {
        expect(fetchPlan).toHaveBeenCalledWith("s-saturday");
        expect(screen.getByRole("tablist", { name: "Prep days" })).toBeTruthy();
        expect(screen.queryByRole("heading", { name: /^Plan for/ })).toBeNull();
      },
    ],
    [
      "/?view=shopping&service=s-saturday",
      "the Service's Shopping list",
      () => expect(fetchShoppingList).toHaveBeenCalledWith("s-saturday"),
    ],
  ])("opens %s on a screen that reads %s", async (url, _reads, check) => {
    window.history.replaceState(null, "", url);
    renderWired(<App />);
    await screen.findByRole("button", { name: "Sign out" });
    await waitFor(check);
  });

  it("opens a view from the nav and writes it into the link", async () => {
    window.history.replaceState(null, "", "/?menu=m-dinner&view=today&service=s-saturday");
    renderWired(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Catalog" }));
    expect(await screen.findByRole("heading", { name: "Ingredient catalog" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Catalog", pressed: true })).toBeTruthy();
    expect(window.location.search).toBe("?menu=m-dinner&view=catalog");
  });

  it("opens a Recipe from the Recipes list and names it in the link", async () => {
    window.history.replaceState(null, "", "/?view=recipes");
    renderWired(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Velouté" }));
    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledWith("r-veloute"));
    expect(window.location.search).toBe("?view=recipe&recipe=r-veloute");
    expect(screen.getByRole("button", { name: "Recipes", pressed: true })).toBeTruthy();
  });

  it("signs in: pending while Supabase checks, then the screen once the session arrives", async () => {
    auth.getSession.mockResolvedValue(signedOut());
    let answer!: (result: SignInResult) => void;
    auth.signInWithPassword.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderWired(<App />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "cook@miseflow.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(auth.signInWithPassword.mock.calls).toEqual([
      [{ email: "cook@miseflow.test", password: "a-password" }],
    ]);
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(true);

    const user = { id: "u-cook" } as User;
    act(() => answer({ data: { user, session }, error: null }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(false),
    );
    await authChange("SIGNED_IN", session);
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    await waitFor(() => expect(fetchMenus).toHaveBeenCalled());
  });

  it("shows Supabase's error for wrong credentials and stays on sign-in", async () => {
    auth.getSession.mockResolvedValue(signedOut());
    // What the local stack answers for a wrong password (checked 29 Oct 2026).
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" } as AuthError,
    });
    renderWired(<App />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "cook@miseflow.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid login credentials");
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("returns to sign-in on sign-out", async () => {
    renderWired(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(auth.signOut.mock.calls).toHaveLength(1);
    await authChange("SIGNED_OUT", null);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("follows a session that changes elsewhere, such as another tab signing in", async () => {
    auth.getSession.mockResolvedValue(signedOut());
    renderWired(<App />);
    await screen.findByRole("heading", { name: "Sign in" });
    await authChange("SIGNED_IN", session);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("stops listening for auth changes when it closes", async () => {
    const { unmount } = renderWired(<App />);
    await screen.findByRole("button", { name: "Sign out" });
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
