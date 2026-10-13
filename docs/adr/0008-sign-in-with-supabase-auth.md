# Sign in with Supabase Auth, checked by Hono

MiseFlow has one user, signed in with **Supabase Auth by email and password**. Sign-ups are turned off and the single user is created in the Supabase dashboard. In the browser, only supabase-js's auth module is used, never its data API ([ADR 0006](0006-supabase-postgres-through-drizzle.md)). It keeps the session and refreshes it, and every request to Hono carries the access token. Hono checks the token on every request with its built-in `jwk()` middleware, against the project's published public keys, without calling Supabase. The token's user id (`sub`) is the value of every row's owner column. We chose this because it's free, it lives in the Supabase project we already have, and the tokens are what the phase-4 sync engines expect (PowerSync accepts Supabase Auth directly). Decided on [#58](https://github.com/maloferriol/miseflow/issues/58).

## Considered Options

- **Our own password check in Hono** (one password from an environment variable plus a session cookie). It needs no third party, but we'd own session security, and the sync engines would need a token issuer later anyway.
- **Clerk or Auth0.** A second vendor for one user.
- **Magic links or OAuth.** Magic links depend on Supabase's free email service, which sends only a few emails per hour. OAuth needs an app set up with Google or GitHub. A password saved in a password manager is simpler, and it works with the local Supabase stack without sending any email.
