// The mutation hook every intent-keyed save shares (ADR 0007, ADR 0011).
import { useMutation } from "@tanstack/react-query";
import { mutate } from "./api.ts";
import type { Intent } from "./intent.ts";
import type { MutationCall } from "./mutation-call.ts";

/**
 * A mutation that sends `toCall(variables, intent)`. Once it saves, the intent resets, so the
 * next save starts fresh ids, and then `afterSave` runs: the screen's invalidations.
 *
 * `refetch`, when given, runs once the save settles, failed or not, before `afterSave`: a failed
 * save may still have landed when only its response was lost (#127 B), and a retry replays the
 * same ids, so refetching after a failure is safe.
 */
export function useIntentSave<V>(
  intent: Intent,
  toCall: (variables: V, intent: Intent) => MutationCall,
  afterSave: () => unknown,
  refetch?: () => Promise<unknown>,
) {
  return useMutation({
    mutationFn: (variables: V) => mutate(toCall(variables, intent)),
    onSuccess: async () => {
      intent.reset();
      await refetch?.();
      await afterSave();
    },
    onError: async () => {
      await refetch?.();
    },
  });
}
