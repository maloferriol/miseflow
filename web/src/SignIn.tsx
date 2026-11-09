// Sign-in (ADR 0008, ADR 0011): its hook, its view, and the SignIn that wires them.
import { type SubmitEvent, useState } from "react";
import { fieldText } from "./form-fields.ts";
import { signInFailureMessage } from "./sign-in.ts";
import { supabase } from "./supabase.ts";

/**
 * Signs in with an email and password: pending while Supabase checks, then its error message, if
 * any, or a "Could not sign in" message if the request fails outright. A success shows nothing
 * here; the app shell hears of the new session.
 */
export function useSignIn() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(email: string, password: string) {
    setPending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setError(error?.message ?? null);
    } catch (thrown) {
      setError(signInFailureMessage(thrown));
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    error,
    onSignIn: (email: string, password: string) => void signIn(email, password),
  };
}

export type SignInViewProps = {
  pending: boolean;
  error: string | null;
  onSignIn: (email: string, password: string) => void;
};

export function SignInView({ pending, error, onSignIn }: Readonly<SignInViewProps>) {
  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSignIn(fieldText(form, "email"), fieldText(form, "password"));
  }

  return (
    <form onSubmit={onSubmit}>
      <h2>Sign in</h2>
      <label>
        Email <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" disabled={pending}>
        Sign in
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function SignIn() {
  return <SignInView {...useSignIn()} />;
}
