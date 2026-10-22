# MiseFlow

A software to manage your cooking: recipes, ingredients, and meal prep workflow.

## Local development

Needs Node 24+ and Docker.

```sh
npm install
cp .env.example .env        # local-only values, including the test user
npx supabase start          # on a fresh clone, run `npm run setup:local` first (see below)
npm run setup:local         # ES256 signing key (git-ignored), starts the stack, seeds the test user
npm run db:migrate          # drizzle-kit migrate; Supabase CLI migrations are not used
npm run dev:server          # API on http://localhost:8787
npm run dev:web             # web app on http://localhost:5173
```

The stack reads `supabase/signing_keys.json`, which `npm run setup:local` creates, so on a fresh
clone `npx supabase start` fails until that has run once. `npm run setup:local` starts the stack
itself.

- `npm test` runs every workspace's tests against the local stack.
- `npm run e2e` runs the Playwright test (`npx playwright install chromium` once).
- `TOKEN=$(npm run -s token -w server)` prints the test user's access token for curl.
