# Research: tests for the web's React components

28 Oct 2026 · answers "Should the web get component tests, and at what cost?" and feeds [ADR 0011](../adr/0011-web-screens-split-into-core-hook-and-view.md).

Method: a read of `origin/main` at `ce32c38` (`web/src`, `vitest.config.ts`, `ci.yml`, `sonar-project.properties`), plus one local run of the e2e. Claims marked **(reasoned)** are my inference, not measured. Claims marked **(unverified)** were not checked against a primary source today.

## Recommendation

**Split the screens that have branches into core, hook and view, and test the view with props in jsdom** (ADR 0011). **Park component tests that run against a faked API.** Rerun the estimate below once `MenuScreen` has been split, and record there whether that option is still needed.

## Where things stood

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

## Estimate for B

This is the option parked by ADR 0011.

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

## When to look again

The `MenuScreen` split ticket reruns the estimate above against what's left in the components, and records here whether B is still needed. If what's left is only "which queries refetch", the e2e with `page.waitForResponse` is the cheaper check **(reasoned)**.
