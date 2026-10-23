# MiseFlow

A software to manage your cooking: recipes, ingredients, and meal prep workflow.

## Local development

Needs Node 24+ and Docker.

```sh
npm install
npm run setup:local         # ES256 signing key, starts the stack, writes .env, seeds the test user
npm run db:migrate          # drizzle-kit migrate; Supabase CLI migrations are not used
npm run seed -w server      # the shared Ingredient seed (ODbL); safe to run again
npm run dev:server          # API on http://localhost:8787
npm run dev:web             # web app on http://localhost:5173
```

`npm run setup:local` starts the stack itself. It creates `supabase/signing_keys.json`, so on a
fresh clone `npx supabase start` fails until `npm run setup:local` has run once; afterwards
`npx supabase start` restarts the stack.

It also writes the git-ignored `.env` from `npx supabase status`, with a random password for the
test user (`.env.example` lists the names). An existing `.env` is kept; delete it to write a fresh
one. Every checkout on this machine shares one local stack and one test user, so running it in a
second checkout resets that user's password: copy the first checkout's `.env` instead.

- `npm test` runs every workspace's tests against the local stack.
- `npm run e2e` runs the Playwright test (`npx playwright install chromium` once).
- `TOKEN=$(npm run -s token -w server)` prints the test user's access token for curl.
- `KITCHEN_TIME_ZONE` (an IANA name such as `Europe/Paris`) sets the kitchen's time zone for
  Service times and Availability. Unset, the server uses its own zone and warns on startup.
- `npm test`, `npm run e2e` and `npm run setup:local` refuse a `.env` whose `DATABASE_URL`,
  `SUPABASE_URL` or `VITE_SUPABASE_URL` is not on the local stack, so they never touch cloud data.

## Cloud setup

The cloud project is set up by hand in the Supabase dashboard (#81):

- **Auth:** Email provider on. Turn off "Allow new users to sign up" in Authentication → Sign In /
  Providers; the Email provider's own sign-up toggle is not enough. Create the single user in
  Authentication → Users with Auto Confirm.
- **JWT keys:** the current signing key must be asymmetric (ECC P-256 or RSA). Hono's `jwk()`
  accepts only ES256 and RS256.
- **Data API:** off. Only the server reaches Postgres, through Drizzle (ADR 0006).

A cloud `.env` needs four names only:

- `DATABASE_URL`: the **session pooler** string (Connect → Session pooler, port 5432). Use the
  session pooler only: the server's postgres.js client uses prepared statements, which the
  transaction pooler (port 6543) does not support, and the direct connection is IPv6-only on the
  Free plan.
- `SUPABASE_URL`: `https://<project-ref>.supabase.co`. The server derives the token issuer
  (`<SUPABASE_URL>/auth/v1`) and the JWKS URL from it.
- `VITE_SUPABASE_URL`: the same URL, for the browser.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key.

Run `npm run db:migrate`, then `npm run seed -w server` (the shared Ingredient seed), against it.
Do not run `npm test`, `npm run e2e` or `npm run setup:local` in a checkout whose `.env` holds
cloud values; they refuse to.
