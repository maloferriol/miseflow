# One env file per environment, picked by APP_ENV

MiseFlow has two environments: **test**, the local Supabase stack that development, `npm test`, `npm run e2e` and CI run against, and **prod**, the hosted Supabase project that holds the real data. Each has one git-ignored file at the repo root, `.env.test` and `.env.prod`, and a run reads exactly one of them. `APP_ENV` picks it (unset means test), and one shared loader serves the browser, the server, drizzle-kit and the seed alike. Vite loads no env files itself (`envDir: false`); it gets its `VITE_`-prefixed values from that loader. We chose this because Vite's own loading silently layered `.env.local` over `.env`: the browser signed in against prod while the server read and wrote the local stack, and nothing warned. Tests and `npm run setup:local` still refuse prod values, and `db:migrate` against prod shows the target project and asks for it to be typed back before it runs.

## Considered Options

- **Keep Vite's env-file handling** (`.env`, `.env.local`, `.env.[mode]`) and teach the server the same order. Vite layers several files by mode, so a run's values come from more than one file, and the mode names (`development`, `test`, `production`) don't match ours.
- **A second hosted project for tests.** It would need the network and CI secrets for every run, while the local stack is free, works offline and CI already starts a fresh one per run.

## Consequences

- `.env.test` holds the local stack's URLs and keys only, which are the Supabase CLI's well-known defaults. It has no test user: each checkout creates its own user with a fresh password on every test run, and `npm run dev:user` prints credentials for signing in by hand.
- `.env.prod` is the only copy of the prod database password. It's rebuilt from the Supabase dashboard when lost; a password manager can fill it later.
