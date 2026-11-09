// Sign-in's decisions (ADR 0011): pure, so the hook only passes them through.

/**
 * What the cook sees when the sign-in request fails outright. Supabase usually answers with
 * `{ error }`, but a failed request can reject instead (#195).
 */
export function signInFailureMessage(thrown: unknown): string {
  return `Could not sign in (${thrown instanceof Error ? thrown.message : String(thrown)})`;
}
