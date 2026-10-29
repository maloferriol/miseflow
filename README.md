# MiseFlow

A software to manage your cooking: recipes, ingredients, and meal prep workflow.

## Local development

Needs Node 24+ and Docker.

```sh
npm run preflight           # checks Node, Docker and ports; installs dependencies; writes .env.test
npm run db:migrate          # drizzle-kit migrate against test (local only); Supabase CLI migrations are not used
npm run seed -w server      # the shared Ingredient seed (ODbL); safe to run again
npm run dev:server          # API on http://localhost:8787
npm run dev:web             # web app on http://localhost:5173
```

Two environments, each with one git-ignored file at the repo root (ADR 0012): **test**, the local
Supabase stack (`.env.test`), and **prod**, the hosted project (`.env.prod`). `APP_ENV` picks the
file; unset means test, and any value but `test` or `prod` is an error. Every part of a run (the
browser, the server and its scripts, drizzle-kit, the seed, Vitest, Playwright, `preflight` and
`check`) reads that one file through the loader in `scripts/env.ts`. Vite loads no env files of
its own, so a `.env.local` or `.env` changes nothing; they are reported by `preflight` and
`setup:local`, which tell you to rename them (`.env` to `.env.test`, `.env.local` to `.env.prod`).

`npm run preflight` is the first step in any new clone or worktree, and safe to run again. It
stops at the first problem (Node older than 24, Docker not running, the stack stopped, a `.env.test`
with prod values, or port 8787 or 5173 held by a server from another checkout) and prints the fix.
Otherwise it runs `npm ci --ignore-scripts` when `node_modules` is missing or older than
`package-lock.json`, and `npm run setup:local` when `.env.test` is missing. A missing or logged-out
`gh` only warns. It doesn't check Claude skills: sessions need the `mattpocock-skills` plugin
installed in your Claude config.

`npm run setup:local` (ES256 signing key, starts the stack, writes `.env.test`; it creates no user)
starts the stack itself. It creates `supabase/signing_keys.json`, so on a
fresh clone `npx supabase start` fails until `npm run setup:local` has run once; afterwards
`npx supabase start` restarts the stack.

It also writes the git-ignored `.env.test` from `npx supabase status` (`.env.example` lists the
names). An existing `.env.test` is kept; delete it to write a fresh one. Don't copy another
checkout's `.env.test`.

Every checkout signs in as its own test user, `checkout-<directory name>-<hash>@miseflow.test`,
created on first use on the shared local stack. Each use gives it a new random password that is
kept in memory only, so no file holds it and one checkout never breaks another. `npm test` signs
in as it. To sign in by hand in `npm run dev:web`, run `npm run dev:user`: it resets the password
and prints the email and the new password. Old checkouts' users stay on the stack until
`npx supabase db reset`. e2e keeps its own user per spec.

- `npm test` runs every workspace's tests against the local stack. `npm run test:coverage` does
  the same and writes `<workspace>/coverage/lcov.info` for `shared`, `server` and `web`.
- `npm run format` formats the code and config files with Prettier (`npm run format:check`
  only checks). Markdown, the drizzle-kit migrations, `package-lock.json` and `supabase/` are left
  alone (`.prettierignore`). To have `git blame` skip the one-time reformat, run
  `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- `npm run lint` runs ESLint (`eslint.config.js`) over `shared`, `server`, `web`, `e2e` and
  `scripts`, with typescript-eslint's type-aware recommended rules and React's hooks rules in
  `web`. Warnings fail it too. `npx eslint . --fix` fixes what it can.
- `npm run e2e` runs the Playwright test (`npx playwright install chromium` once).
- `npm run check` runs what CI's required `check` job depends on, before you open a PR: the
  `static` steps (format check, lint, typecheck, build) and the `test` steps (`setup:local`,
  `db:migrate`, `npm test`) as two groups at the same time. A group stops at its first failure.
  It prints each step's result and duration, then whether CI would pass, and exits non-zero when
  it wouldn't. It runs `npm ci --ignore-scripts` first only when `node_modules` is older than
  `package-lock.json`, and reuses the running local stack. A failed step's output is printed;
  passing steps stay quiet. Node other than 24, the version CI runs, only warns. It doesn't run
  the SonarQube analysis, so a pass here can still fail CI's quality gate (see below).
  - `--coverage` runs `test:coverage` instead of `npm test`.
  - `--e2e` runs `npm run e2e` after the other groups, whatever they did. Its result is reported
    but, as in CI, doesn't fail the run.
- `TOKEN=$(npm run -s token)` prints an access token for the checkout's test user, for curl.
- `KITCHEN_TIME_ZONE` (an IANA name such as `Europe/Paris`) sets the kitchen's time zone for
  Service times and Availability. Unset, the server uses its own zone and warns on startup.
- `npm test`, `npm run e2e` and `npm run setup:local` refuse an env file whose `DATABASE_URL`,
  `SUPABASE_URL` or `VITE_SUPABASE_URL` is not on the local stack, so they never touch prod data.

## CI and the quality gate

`.github/workflows/ci.yml` runs on every pull request and every push to `main`, as three jobs on separate
runners that start together, each after `npm ci`:

- `static`: `npm run format:check`, `npm run lint`, `npm run typecheck`, then `npm run build`.
- `test`: `npm run setup:local`, `npm run db:migrate` and `npm run test:coverage` against a local Supabase stack
  on the runner. The three `lcov.info` files are uploaded as the run's `coverage` artifact. Then the SonarQube
  analysis runs on the coverage.
- `e2e`: its own Supabase stack, then `npm run e2e` with one retry, as a non-blocking step: a failure shows as
  an annotation but doesn't fail the check. Its HTML and JSON reports are uploaded as the `e2e-reports` artifact.

CI starts the stack without the services these runs don't use: the workflow sets `SUPABASE_START_EXCLUDE`, which
`setup:local` passes to `supabase start -x`, and turns Realtime and Storage off so the CLI doesn't pull their
images to set up their schemas. Unset, as on a laptop, every service starts.

The `check` job passes when `static` and `test` both pass, and fails otherwise. It is the check the `main`
ruleset requires.

**Connecting the analysis** (once, by the repo owner). The workflow skips the analysis until
`SONAR_TOKEN` is set.

1. Create the project in SonarQube Cloud by importing this GitHub repository, with the key
   `maloferriol_miseflow` (`sonar-project.properties`). Importing installs the SonarQube Cloud
   GitHub app, which posts the results on each pull request. SonarQube Cloud is free for a public
   repository like this one. A self-hosted SonarQube server works too, with its GitHub
   integration set up for pull request decoration.
2. In the project's Administration → Analysis Method, turn off Automatic Analysis. It conflicts
   with the CI analysis, which is the one that has coverage.
3. In GitHub, Settings → Secrets and variables → Actions:
   - secret `SONAR_TOKEN`: a SonarQube token with analysis rights. Store it only here, never in a
     file.
   - variable `SONAR_ORGANIZATION`: the SonarQube Cloud organization key. Leave it unset for a
     SonarQube server.
   - variable `SONAR_HOST_URL`, only for a SonarQube server. Unset, the workflow uses
     `https://sonarcloud.io`.

**The quality gate** is the project's gate in SonarQube, "Sonar way" by default. It checks new
code only (the pull request's changes, or the new-code period on `main`): no new issues, every
new security hotspot reviewed, coverage of at least 80%, and at most 3% duplicated lines. The
scan waits for the gate (`sonar.qualitygate.wait`) and fails the CI check when the gate fails.
The `main: require CI check` ruleset is active and requires the `check` job, so a failing
check blocks the merge. GitHub withholds secrets from pull requests opened from forks, so on
those the analysis is skipped and `check` covers formatting, lint, typecheck, build and tests only.

**Running the analysis locally** uses the same properties file. Run `npm run test:coverage`
first, then:

```sh
docker run --rm -v "$PWD:/usr/src" -e SONAR_TOKEN -e SONAR_HOST_URL=https://sonarcloud.io \
  sonarsource/sonar-scanner-cli -Dsonar.organization=<organization>
```

`SONAR_TOKEN` comes from your shell, never from a file in the repo. A local run analyzes the
current branch. Only CI runs report on pull requests.

## Prod setup

The prod project (the hosted Supabase project) is set up by hand in the Supabase dashboard (#81):

- **Auth:** Email provider on. Turn off "Allow new users to sign up" in Authentication → Sign In /
  Providers; the Email provider's own sign-up toggle is not enough. Create the single user in
  Authentication → Users with Auto Confirm.
- **JWT keys:** the current signing key must be asymmetric (ECC P-256 or RSA). Hono's `jwk()`
  accepts only ES256 and RS256.
- **Data API:** off. Only the server reaches Postgres, through Drizzle (ADR 0006).

A `.env.prod` needs four names only:

- `DATABASE_URL`: the **session pooler** string (Connect → Session pooler, port 5432). Use the
  session pooler only: the server's postgres.js client uses prepared statements, which the
  transaction pooler (port 6543) does not support, and the direct connection is IPv6-only on the
  Free plan.
- `SUPABASE_URL`: `https://<project-ref>.supabase.co`. The server derives the token issuer
  (`<SUPABASE_URL>/auth/v1`) and the JWKS URL from it.
- `VITE_SUPABASE_URL`: the same URL, for the browser.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key.

`.env.prod` replaces the old `.env.local`. It is git-ignored, mode 600 (`chmod 600 .env.prod`) and
kept only in the main checkout, never in a worktree.

To rebuild it if it is lost:

- `DATABASE_URL`: in the Supabase dashboard, Connect → Session pooler, copy the string. If you no
  longer know the database password, reset it in Project Settings → Database and put the new one
  into the string.
- `SUPABASE_URL` and `VITE_SUPABASE_URL`: `https://<project-ref>.supabase.co`, the project ref
  being in the dashboard URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Project Settings → API Keys, the publishable key.

### Using the app against prod

```sh
npm run dev:prod     # the API and the web app together, both reading .env.prod (APP_ENV=prod)
```

Signing in and saving then hit the prod project, so a saved Recipe lands in your real data. With
`APP_ENV=prod` the server checks for pending migrations at startup and refuses to start while any
are waiting, naming `npm run db:migrate:prod` as the fix. It never prints the database password.
No automated test runs against prod.

### Migrating and seeding prod

Prod is migrated and seeded on purpose, never by accident. After merging a PR that adds a
migration, run, from the checkout that holds `.env.prod`:

```sh
npm run db:migrate:prod     # shows the prod project ref and the migrations waiting, asks you to type the ref back
npm run db:seed:prod        # the shared Ingredient seed against prod (APP_ENV=prod); safe to run again
```

`db:migrate:prod` prints the project ref only (never `DATABASE_URL`, which holds the password),
applies nothing until the typed ref matches, and says "Nothing pending" and exits when prod is up
to date, so running it again is harmless. Plain `npm run db:migrate` only ever targets test: it
refuses a `DATABASE_URL`, `SUPABASE_URL` or `VITE_SUPABASE_URL` that is not local. Do not run
`npm test`, `npm run e2e` or `npm run setup:local` with `APP_ENV=prod`; they refuse prod values.

## Working with agents

The work runs through the [mattpocock skills](https://github.com/mattpocock/skills). You type the
flow skills; an agent can't start them by itself.

1. **Not sure what to build yet:** `/wayfinder` keeps a map issue of decision tickets (research,
   prototype, grilling or task). Each run claims one unblocked ticket and resolves it, through
   `/research`, `/prototype`, or `/grilling` with `/domain-modeling`. It doesn't build anything.
2. **`/to-spec`**, in the session that holds the context, turns the map's decisions or the
   conversation into a spec issue labelled `ready-for-agent`. It checks the testing seams with
   you: that's where your questions get answered.
3. **`/to-tickets <spec #>`** splits the spec into tracer-bullet tickets (sub-issues with native
   blocking links), and checks the breakdown with you before publishing.
4. **`/implement-spec <spec #>`** builds the whole spec on one integration branch, with one PR per
   spec: an implementer subagent per ticket with `tdd`, a merger subagent, then `code-review`.
   For a single small ticket, use `/implement <ticket #>`.

Clear the context between specs. Other entry points: `/triage` for incoming issues,
`/diagnosing-bugs`, `/improve-codebase-architecture` and `/retro`. For an unattended run, type
`/goal The PR for spec #<n> is ready for review and its URL is in the last message, or the last
message says why the run can't go on.`
