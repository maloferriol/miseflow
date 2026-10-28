# Research: tests for the web's React components

28 Oct 2026 · answers "Should the web get component tests, and at what cost?" and feeds [ADR 0011](../adr/0011-web-screens-split-into-core-hook-and-view.md).

Method: a read of `origin/main` at `ce32c38` (`web/src`, `vitest.config.ts`, `ci.yml`, `sonar-project.properties`), plus one local run of the e2e. Claims marked **(reasoned)** are my inference, not measured. Claims marked **(unverified)** were not checked against a primary source today.

## Recommendation

**Split the screens that have branches into core, hook and view, and test the view with props in jsdom** (ADR 0011). **Drop component tests that run against a faked API (option B).** The rerun after the Step editor and Menu screen splits, below, found nothing left that B would test more cheaply than the layers we now have.

## Where things stood (28 Oct 2026, before the splits)

- **No test renders React.** The 18 `.tsx` files (about 3,100 lines) have no unit test. `web` has 5 test files for its pure modules, and vitest runs them in Node.
- **The e2e is fast but runs only locally.** 27 tests passed in 19.2s (Playwright: 18.5s) with 5 workers, on 28 Oct 2026. The slowest were `test-user` at 5.3s and two Gantt drags at 4.0s and 2.2s. Every other test took 0.4–1.7s. CI already starts the local Supabase stack but doesn't run the e2e.
- **The e2e reaches few states.** Only `recipe` and `gantt` fake a network failure. The loading, error, empty and pending branches of the screens are mostly untested.

## What the code means for a DOM test

- **Every network call goes through `web/src/api.ts`.** `mutate()` calls the global `fetch`, and reads go through the Hono `hc` client, which uses `fetch` too. No `.tsx` calls `fetch` directly.
- **The QueryClient has default options** (`main.tsx`, `new QueryClient()`). A test would need `retry: false`, or every error-state test waits through three retries.
- **No screen needs a Supabase session.** Only `App` checks for one. Screens take ids from props or from the URL, and `MenuScreen` reads `?menu=` from `window.location`.
- **There's no dependency injection.** `QueryClientProvider` is the only context.
- **jsdom would need stubs** for `window.print` and `window.confirm` (`PlanScreen`). It has no `setPointerCapture`, which only the Gantt uses. Nothing in `web/src` measures layout, and Node 24 provides `crypto.randomUUID`.
- **Coverage already counts `.tsx` files**: the vitest `include` is `src/**`. Sonar's test patterns list only `*.test.ts`, so a `*.test.tsx` would be counted as source code until the patterns are updated.

## The options

| | A. Extract decisions only | B. Components with a faked API | C. Core, hook and view (chosen) |
|---|---|---|---|
| Logic is tested as | Pure unit tests | DOM interactions | Pure unit tests |
| States a screen shows | e2e only | Component tests | View tests with props |
| Wiring: the mutation and args sent | e2e only | Component tests, by checking the request | Core unit tests of the args; e2e for the end result |
| Wiring: disabled while pending, inline error | e2e only | Component tests | View tests with props |
| Wiring: which queries refetch | e2e only | Component tests | e2e only |
| New test setup | None | jsdom, Testing Library, MSW, a test QueryClient, typed fake data | jsdom, Testing Library |
| Refactor needed | Small | None | One ticket per screen that's split |

Names for these patterns **(unverified)**: C's core is *functional core, imperative shell* (Gary Bernhardt, "Boundaries", 2012) and the *Humble Object* (Gerard Meszaros, *xUnit Test Patterns*). Its hook and view are *container* and *presentational* components (Dan Abramov, 2015). A note Abramov added in 2019 says he no longer recommends splitting every component now that hooks exist. B is the Testing Library approach of testing what the user sees (Kent C. Dodds).

## Estimate for B, before the splits

This is the option parked by ADR 0011. The rerun below replaces it.

| Piece | Rough size |
|---|---|
| devDeps: `jsdom`, `@testing-library/react`, `msw` | 3 packages |
| `web/vitest.config.ts`: a jsdom `projects` entry for `*.test.tsx` | ~20 lines |
| `renderScreen()`: a fresh QueryClient with `retry: false`, the starting URL, stubs for `print` and `confirm` | ~40 lines |
| MSW handlers for `/api/*`, typed against the server's `AppType` | ~50 lines, plus data per screen |
| Sonar test patterns | 2 lines |
| Tests per screen: loading, error, empty, then wiring per mutation (`MenuScreen`: 3 queries, 5 mutations, 4 invalidations) | ~150–250 lines |
| **Total** | **~150–200 lines and docs, then about one ticket per screen. 16 `.tsx` files call the API.** |

**What it costs beyond its size (reasoned):**

1. **A second copy of the API.** Typing the handlers against `AppType` catches a change in shape, but not a change in behaviour: a fake can return a Plan the scheduler would never produce.
2. **It goes against a standard.** Fake responses written by hand break "expected values come from a real run". Capturing them from the server's `testApp()` on the walkthrough would fix that, at the cost of more setup.
3. **A third place a test can live.** Logic drifts back into components once components are testable.
4. **The tooling has rough edges.** `act()` warnings under React 19, and the Gantt stays e2e-only.

**What it would buy:** mainly the states a screen shows and the wiring. Option A shrinks the first, because it moves validation into the core. C covers most of what's left without a faked API. B's one remaining advantage is checking which queries refetch without running the e2e.

## Rerun after the splits

28 Oct 2026 · a read of `ticket/172-component-test-estimate` at `cec45b6`, which holds the Step editor split (#170, draft PR #175) and the Menu screen split (#171, draft PR #176 on top of it), plus the CI runs of the e2e since #168.

### What changed

- **Hooks now get tests**, against ADR 0011's "Hooks get no test of their own". The owner decided this so the splits pass SonarCloud's 80% gate on new code. A hook runs through `renderQueryHook()` and a wired component (hook plus view) through `renderWired()`, both in `web/test/render-view.tsx`. Each renders inside a real QueryClient with `retry: false`. Only `./api.ts` is faked, with `vi.mock`. See `web/src/StepEditor.test.tsx`, `web/src/LinkChoice.test.tsx` and `web/src/MenuScreen.test.tsx`.
- **That is a faked API, at the module boundary.** `vi.mock("./api.ts")` stands in for the server one layer above `fetch`, which is where MSW would sit. The QueryClient, the hooks, `useIntent` and the views all run for real. So B's setup (jsdom, Testing Library, a test QueryClient, typed fake data) is already in the repo, minus MSW. Its two costs come with it, at a smaller size: the fake responses are hand-written, and they are typed by `api.ts`'s return types, which catches a change in shape but not in behaviour.
- **The e2e runs in CI** (#168), as a non-blocking step in the `check` job.

### What each layer covers now, on the split screens

| | Step editor (`StepEditor.tsx`, `StepForm.tsx`, `LinkChoice.tsx`) | Menu screen (`MenuScreen.tsx`, `MenuViews.tsx`) |
|---|---|---|
| Core unit tests | `step-editor.test.ts`, `step-links.test.ts`: when the `@` picker opens, a pick's text and caret, which names block Save, the save itself | `menu-screen.test.ts`: Guests and Service-time parsing, the args for a Dish's scale and the Service |
| View tests with props | `StepForm.test.tsx`, `LinkChoice.test.tsx`: Save disabled while pending or unmatched, the save error `alert`, the picker, the caret after a pick | `MenuViews.test.tsx`: Loading…, the error `alert`, the empty Menu list, each form's pending and inline error |
| Hook tests | each mutation's name and args, a retry's id, pending then error, which queries are invalidated | the same, for all 3 queries, 5 mutations and 4 invalidations, plus `?menu=` after a create |
| Wired tests | the picker, a Recipe pick, the picker's close and the link choice reach the form | the Menu list, a create that opens the Menu, and each part's form reaching its hook |
| e2e | `recipe`, `subrecipes`: the whole editor, including a lost response replayed | `menu`, `planning`, `plan`: the whole screen against the server |

**What's left (reasoned).** On these two screens, the only code that no test below the e2e runs is `api.ts` itself: the URL and method of each call, the auth header, and how `mutate()` turns a failed response into an `Error` (the server's `error.message`, else `<name> failed (<status>)`). The rest of B's list is covered. "Which queries refetch", which the first estimate gave as B's one remaining advantage, is now checked by the hook tests through the QueryClient's cache. The Step editor's read mode (its chips) has no test below the e2e, and has no branch beyond "a line or nothing".

### The other web screens

None of these is split yet. Counts are of `useQuery`, `useMutation` and `invalidateQueries` calls in each file.

| Screen or part | Queries | Mutations | Invalidations | Logic left in the component | e2e specs |
|---|---|---|---|---|---|
| `AvailabilityScreen.tsx` | 1 | 3 | 2 | | `batches`, `plan`, `today`, `quick-fixes`, `gantt` |
| `CatalogScreen.tsx` | 2 | 2 | 2 | trimming an alias or a name | `catalog` |
| `PlanScreen.tsx` | 2 | 2 | 3 | minutes as `h:mm`, `confirm` before a quick fix | `plan`, `quick-fixes`, `gantt` |
| `PlanningPass.tsx` | 0 | 5 | 1 | an optional number, the Make-ahead window's days, which Steps a Step waits for | `planning` |
| `RecipeScreen.tsx` | 1 | 3 | 2 | name and Servings parsing, which Steps stay selected | `recipe`, `subrecipes` |
| `ExtractToSubRecipe.tsx` | 0 | 1 | 2 | consecutive Steps and a name, the amount defaulting to `1` | `subrecipes` |
| `YieldField.tsx` | 0 | 1 | 2 | the yield as text | `subrecipes` |
| `IngredientPicker.tsx` | 2 | 0 | 0 | leaving out the Recipe being edited | `recipe`; the Step editor's wired tests also render it |
| `RecipesScreen.tsx`, `ShoppingListScreen.tsx`, `TodayScreen.tsx` | 1 each | 1 each | 1 each | `TodayScreen`: a Task's conflicts | `recipe`, `shopping`, `today` |
| `Gantt.tsx` | 0 | 0 | 0 | the drags | `gantt` (jsdom has no pointer capture) |

That's 11 queries, 20 mutations and 17 invalidations, whose loading, error, empty and pending states are still mostly untested below the e2e. Their gap is the one the Menu screen had before #171, so the fix is the same: split a screen once it has a branch worth testing, then test its view with props and its hook against the mocked `api.ts`. MSW would test the same things through one more layer. For scale, the Menu screen's tests are about 660 lines (`MenuViews.test.tsx` 282, `MenuScreen.test.tsx` 381) for 3 queries and 5 mutations.

### The e2e in CI

From the 8 runs of `ci.yml` since the step landed, 28 Oct 2026: 2 on `main` (the merges of #173 and #174) and 6 on PR branches (#173, #174 and #175).

- **27 tests passed in every run**, with no flaky test and no unexpected failure. The first run of #173 also had a spec that fails on purpose, to prove the step is non-blocking.
- **Playwright reports 23.6–39.6s with 2 workers**, against 19.2s locally with 5. The step takes 24–40s and installing Chromium another 14–54s. On `main`, that's about 72s of a 7-minute `check` job, about 17%.
- **`main` is red** on both runs, but from the SonarCloud gate, not the e2e.
- **The data is thin.** 2 runs on `main` of the 20 in a row that CODING_STANDARDS asks for before the step becomes required, and 8 in all. It says the e2e is cheap in CI. It can't yet say the e2e isn't flaky.

### Decision: drop B

**B is dropped (28 Oct 2026).** The hook tests, with `api.ts` mocked and a real QueryClient, already test against a faked API, and they already cover what B was kept for: the mutation and args sent, pending and error states, and which queries refetch. MSW would add only `api.ts`'s own code, which is about 100 lines of the same `if (!res.ok) throw` and runs on every e2e test against the real server. In return it would bring a third copy of each response, under the hook tests' fakes, written at the HTTP level. If `mutate()`'s error message ever needs a test below the e2e, a Node unit test of `api.ts` with `fetch` stubbed (`vi.stubGlobal`) is the cheaper check **(reasoned)**.

So no follow-up issue for B. This PR (#177) also updates ADR 0011 and CODING_STANDARDS, which said a hook gets no test, to match the hook tests.
