import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library can't unmount between tests by itself.
afterEach(cleanup);

/** Renders a view (a component that takes props only) into jsdom; query it through `screen`. */
export function renderView(view: ReactElement) {
  return render(view);
}
