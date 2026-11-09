import type { Action } from "../src/action.ts";

/** An `Action` for a view test's props: idle, with no error and a `run` that does nothing, unless overridden. */
export function action<A>(overrides: Partial<Action<A>> = {}): Action<A> {
  return { pending: false, error: null, run: () => {}, ...overrides };
}
