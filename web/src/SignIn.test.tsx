import type { AuthError, Session, User } from "@supabase/supabase-js";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueryHook, renderView } from "../test/render-view.tsx";
import { SignInView, useSignIn } from "./SignIn.tsx";
import { supabase } from "./supabase.ts";

// The auth boundary only (ADR 0011): sign-in talks to Supabase auth directly.
vi.mock("./supabase.ts", () => ({ supabase: { auth: { signInWithPassword: vi.fn() } } }));

const auth = vi.mocked(supabase.auth);
type SignInResult = Awaited<ReturnType<typeof auth.signInWithPassword>>;

// A success, as far as sign-in reads it: no error.
const signedIn: SignInResult = {
  data: { user: { id: "u-cook" } as User, session: { access_token: "a-token" } as Session },
  error: null,
};

// What Supabase answers for a wrong password (local stack, 29 Oct 2026).
const wrongCredentials = {
  data: { user: null, session: null },
  error: { message: "Invalid login credentials" } as AuthError,
} as SignInResult;

// A sign-in that stays pending until the test answers it.
function answerLater() {
  let answer!: (result: SignInResult) => void;
  auth.signInWithPassword.mockReturnValueOnce(
    new Promise<SignInResult>((resolve) => (answer = resolve)),
  );
  return (result: SignInResult) => act(() => answer(result));
}

beforeEach(() => {
  auth.signInWithPassword.mockReset().mockResolvedValue(wrongCredentials);
});

describe("the sign-in hook", () => {
  it("is pending while Supabase checks the email and password", async () => {
    const answer = answerLater();
    const { result } = renderQueryHook(useSignIn);
    act(() => result.current.onSignIn("cook@miseflow.test", "a-password"));
    expect(result.current.pending).toBe(true);
    expect(auth.signInWithPassword.mock.calls).toEqual([
      [{ email: "cook@miseflow.test", password: "a-password" }],
    ]);
    answer(signedIn);
    await waitFor(() => expect(result.current).toMatchObject({ pending: false, error: null }));
  });

  it("returns Supabase's message for wrong credentials", async () => {
    const { result } = renderQueryHook(useSignIn);
    act(() => result.current.onSignIn("cook@miseflow.test", "wrong"));
    await waitFor(() => expect(result.current.error).toBe("Invalid login credentials"));
    expect(result.current.pending).toBe(false);
  });

  it("clears the last error while it checks again", async () => {
    const { result } = renderQueryHook(useSignIn);
    act(() => result.current.onSignIn("cook@miseflow.test", "wrong"));
    await waitFor(() => expect(result.current.error).toBe("Invalid login credentials"));
    answerLater();
    act(() => result.current.onSignIn("cook@miseflow.test", "a-password"));
    expect(result.current).toMatchObject({ pending: true, error: null });
  });
});

describe("the sign-in view", () => {
  it("sends the email and password the cook typed", () => {
    const onSignIn = vi.fn();
    renderView(<SignInView pending={false} error={null} onSignIn={onSignIn} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "cook@miseflow.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledWith("cook@miseflow.test", "a-password");
  });

  it("disables Sign in while it checks", () => {
    renderView(<SignInView pending error={null} onSignIn={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the error and no alert without one", () => {
    const { rerender } = renderView(<SignInView pending={false} error={null} onSignIn={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<SignInView pending={false} error="Invalid login credentials" onSignIn={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toBe("Invalid login credentials");
  });
});
