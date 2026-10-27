import { useState } from "react";

export type Intent = { id(key: string, name: string): string; reset(): void };

/**
 * The ids of one intended save: the mutation id, the Revision id and new row ids. They are made
 * once and reused by every retry of the same save (the same `key`), so a retry after a lost
 * response replays the same mutation (ADR 0007) instead of applying it twice or hitting a 409.
 * A save with a different key starts fresh ids; call `reset` after a save succeeds.
 *
 * The key must change exactly when the save's args change, since the server replays a known id
 * without comparing args. One slot holds one save, so each mutation gets its own.
 */
export function createIntent(): Intent {
  let slot: { key: string; ids: Map<string, string> } | null = null;
  return {
    id(key, name) {
      if (slot?.key !== key) slot = { key, ids: new Map() };
      let id = slot.ids.get(name);
      if (!id) {
        id = crypto.randomUUID();
        slot.ids.set(name, id);
      }
      return id;
    },
    reset() {
      slot = null;
    },
  };
}

/**
 * `run` with ids from `intent`, keyed on its args: a retry with the same args replays, and the
 * slot resets once `run` succeeds.
 */
export function retryable<A>(
  intent: Intent,
  run: (args: A, id: (name: string) => string) => Promise<void>,
) {
  return async (args: A) => {
    const key = JSON.stringify(args);
    await run(args, (name) => intent.id(key, name));
    intent.reset();
  };
}

/** One `createIntent` slot for the component's lifetime. */
export function useIntent() {
  const [intent] = useState(createIntent);
  return intent;
}
