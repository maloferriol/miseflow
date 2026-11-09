// One mutation as a view sees it (ADR 0011): whether it is running, how it last failed, and how
// to run it. A hook returns one per mutation and a view takes one per button.

export type Action<A> = { pending: boolean; error: Error | null; run: (args: A) => void };

/** The `Action` for a TanStack `useMutation` result. */
export function toAction<A>(mutation: {
  isPending: boolean;
  error: Error | null;
  mutate: (args: A) => void;
}): Action<A> {
  return {
    pending: mutation.isPending,
    error: mutation.error,
    run: (args) => mutation.mutate(args),
  };
}
