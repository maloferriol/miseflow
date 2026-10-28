import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, renderHook } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library can't unmount between tests by itself.
afterEach(cleanup);

/** Renders a view (a component that takes props only) into jsdom; query it through `screen`. */
export function renderView(view: ReactElement) {
  return render(view);
}

// A fresh client per test, so no cache carries over. Queries don't retry, so a failure settles at once.
function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function provider(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/**
 * Renders a screen's hook inside a real QueryClientProvider with a fresh QueryClient; read what
 * it returns through `result.current`, and the cache through `client`.
 */
export function renderQueryHook<R>(hook: () => R) {
  const client = testQueryClient();
  return { client, ...renderHook(hook, { wrapper: provider(client) }) };
}

/** Renders a wired component (hook plus view) inside a real QueryClientProvider with a fresh QueryClient. */
export function renderWired(ui: ReactElement) {
  const client = testQueryClient();
  return { client, ...render(ui, { wrapper: provider(client) }) };
}
