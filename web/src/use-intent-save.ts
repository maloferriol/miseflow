// The mutation hook every intent-keyed save shares (ADR 0007, ADR 0011).
import { useMutation } from "@tanstack/react-query";
import { mutate } from "./api.ts";
import type { Intent } from "./intent.ts";
import type { MutationCall } from "./mutation-call.ts";

/**
 * A mutation that sends `toCall(variables, intent)`. Once it saves, the intent resets, so the
 * next save starts fresh ids, and then `afterSave` runs: the screen's invalidations.
 */
export function useIntentSave<V>(
  intent: Intent,
  toCall: (variables: V, intent: Intent) => MutationCall,
  afterSave: () => Promise<unknown>,
) {
  return useMutation({
    mutationFn: (variables: V) => {
      const call = toCall(variables, intent);
      return mutate(call.id, call.name, call.args);
    },
    onSuccess: async () => {
      intent.reset();
      await afterSave();
    },
  });
}
