import { useMemo, useRef } from "react";

/**
 * The ids of one intended save: the mutation id, the Revision id and new row ids. They are made
 * once and reused by every retry of the same save (the same `key`), so a retry after a lost
 * response replays the same mutation (ADR 0007) instead of applying it twice or hitting a 409.
 * A save with a different key starts fresh ids; call `reset` after a save succeeds.
 */
export function useIntent() {
  const slot = useRef<{ key: string; ids: Map<string, string> } | null>(null);
  return useMemo(
    () => ({
      id(key: string, name: string) {
        if (slot.current?.key !== key) slot.current = { key, ids: new Map() };
        let id = slot.current.ids.get(name);
        if (!id) {
          id = crypto.randomUUID();
          slot.current.ids.set(name, id);
        }
        return id;
      },
      reset() {
        slot.current = null;
      },
    }),
    [],
  );
}
