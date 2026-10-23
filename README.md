# MiseFlow

A software to manage your cooking: recipes, ingredients, and meal prep workflow.

## Local development

Needs Node 24+ and Docker.

```sh
npm install
cp .env.example .env        # local-only values, including the test user
npm run setup:local         # ES256 signing key (git-ignored), starts the stack, seeds the test user
npm run db:migrate          # drizzle-kit migrate; Supabase CLI migrations are not used
npm run seed -w server      # the shared Ingredient seed (ODbL); safe to run again
npm run dev:server          # API on http://localhost:8787
npm run dev:web             # web app on http://localhost:5173
```

`npm run setup:local` starts the stack itself. It creates `supabase/signing_keys.json`, so on a
fresh clone `npx supabase start` fails until `npm run setup:local` has run once; afterwards
`npx supabase start` restarts the stack.

- `npm test` runs every workspace's tests against the local stack.
- `npm run e2e` runs the Playwright test (`npx playwright install chromium` once).
- `TOKEN=$(npm run -s token -w server)` prints the test user's access token for curl.
