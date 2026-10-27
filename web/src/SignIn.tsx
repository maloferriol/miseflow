import { type FormEvent, useState } from "react";
import { supabase } from "./supabase.ts";

export function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) setError(error.message);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)}>
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
