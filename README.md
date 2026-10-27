# MiseFlow

A software to manage your cooking: recipes, ingredients, and meal prep workflow.

## Local development

Needs Node 24+ and Docker.

```sh
npm run preflight           # checks Node, Docker and ports; installs dependencies; writes .env
npm run db:migrate          # drizzle-kit migrate; Supabase CLI migrations are not used
npm run seed -w server      # the shared Ingredient seed (ODbL); safe to run again
npm run dev:server          # API on http://localhost:8787
npm run dev:web             # web app on http://localhost:5173
```

`npm run preflight` is the first step in any new clone or worktree, and safe to run again. It
stops at the first problem (Node older than 24, Docker not running, the stack stopped, a `.env`
with cloud values, or port 8787 or 5173 held by a server from another checkout) and prints the fix.
Otherwise it runs `npm ci --ignore-scripts` when `node_modules` is missing or older than
`package-lock.json`, and `npm run setup:local` when `.env` is missing. A missing or logged-out
`gh` only warns. It doesn't check Claude skills: sessions need the `mattpocock-skills` plugin
installed in your Claude config.

`npm run setup:local` (ES256 signing key, starts the stack, writes `.env`, seeds the test user)
starts the stack itself. It creates `supabase/signing_keys.json`, so on a
fresh clone `npx supabase start` fails until `npm run setup:local` has run once; afterwards
`npx supabase start` restarts the stack.

It also writes the git-ignored `.env` from `npx supabase status`, with a random password for the
test user (`.env.example` lists the names). An existing `.env` is kept; delete it to write a fresh
one. Every checkout on this machine shares one local stack and one test user, so running it in a
second checkout resets that user's password: only the checkout that ran it last
logs in. When another checkout's tests fail with `Invalid login credentials`, rerun
`npm run setup:local` there. Don't copy another checkout's `.env`.

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
- `TOKEN=$(npm run -s token -w server)` prints the test user's access token for curl.
- `KITCHEN_TIME_ZONE` (an IANA name such as `Europe/Paris`) sets the kitchen's time zone for
  Service times and Availability. Unset, the server uses its own zone and warns on startup.
- `npm test`, `npm run e2e` and `npm run setup:local` refuse a `.env` whose `DATABASE_URL`,
  `SUPABASE_URL` or `VITE_SUPABASE_URL` is not on the local stack, so they never touch cloud data.

## CI and the quality gate

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `npm ci`,
`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, then
`npm run setup:local`, `npm run db:migrate` and `npm run test:coverage` against a local Supabase stack on the runner.
Any failing step fails the check. The three `lcov.info` files are uploaded as the run's `coverage` artifact, and then the
SonarQube analysis runs on them.

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
