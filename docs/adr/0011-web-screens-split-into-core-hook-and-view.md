# Web screens split into core, hook and view

A web screen whose branches a test should cover is split into three layers. The **core** is pure TypeScript in `shared/` or a `web/src/*.ts` module: decisions, validation, formatting, and the name and args of each named mutation (ADR 0007). The **hook** is one per screen (`useMenuScreen()`) and only calls `useQuery`, `useMutation` and `useIntent`, passing the core's results through. The **view** takes props and renders JSX, with no fetching. The exported screen is `const s = useMenuScreen(); return <MenuView {...s} />`. We split this way so each layer gets the cheapest test that fits it: the core gets unit tests in Node, as `shared/` does today. The view gets jsdom tests that pass plain props, so it needs no faked API. The hook has nothing to test, and the e2e covers the whole screen. Decided in the grilling session of 28 Oct 2026, from the estimate in [component-tests.md](../research/component-tests.md).

## Consequences

- **Decisions move out, state stays.** Every component moves any branch or calculation a test should catch into the core. A `useState` that only holds what the cook typed, or a value set once when a form opens, stays in the component. There are no reducers: one would mostly re-describe its fields.
- **Only screens with branches get the split.** A screen with nothing to test stays one component. `StepEditor` goes first, then `MenuScreen`. The Gantt's logic goes into the Plan preview interface ([architecture review](../architecture/2026-10-26-deepening-opportunities.md), candidate 3) and its drags stay in e2e, because jsdom has no pointer capture.
- **The hook stays thin.** If a hook grows a branch, the branch moves into the core. Hooks get no test of their own, so tests never fake `mutate` or the QueryClient.
- **View tests** are `*.test.tsx` files run under jsdom through a vitest `projects` entry, while the `.ts` tests stay in Node. They find elements by role and visible text, check what callbacks are called with, and use no snapshots. Props for loading, error and pending states can be written by hand. Any prop that holds a computed value comes from ADR 0004's walkthrough or a core function run on it.
- **The Playwright e2e stays the only test in a real browser** and the only test that crosses the network.

## Considered Options

- **Keep the logic in components and test it through the DOM** (Testing Library, with the API faked at `fetch`). It needs no refactor, and the tests survive internal rewrites. It was rejected for three reasons. The faked API is a second copy of the server that can drift from the real one. Hand-written fake responses go against "expected values come from a real run". And covering each pair of cook-set inputs through clicks and typing costs more than a unit test does. It stays open: [component-tests.md](../research/component-tests.md) holds its estimate, to be rerun once `MenuScreen` has been split.
- **Extract decisions only, without hook and view.** This is the minimum every component meets anyway. On its own it leaves the states a screen shows (loading, error, empty, pending) to the e2e.
- **Split every component.** Presentational and container components applied everywhere, which its own author later stopped recommending once hooks existed. It adds hooks that only wrap `useQuery` and props passed down for nothing.
