// One named mutation as the screens send it (ADR 0007), and the ids that make a retry of it replay.
import type { Intent } from "./intent.ts";

/** One named mutation (ADR 0007) and the id that makes a retry of it replay. */
export type MutationCall = { id: string; name: string; args: Record<string, unknown> };

// One set of ids per intended save, keyed on its name and args, so a retry after a lost response
// replays it (useIntent), with the id of the row it adds as `<slot>Id`.
function keyedCall<A extends object>(
  name: string,
  args: A,
  intent: Pick<Intent, "id">,
  slot: "revision" | "override",
): MutationCall {
  const key = JSON.stringify([name, args]);
  return {
    id: intent.id(key, "mutation"),
    name,
    args: { [`${slot}Id`]: intent.id(key, slot), ...args },
  };
}

/** A save that appends one Revision, its `revisionId` kept by a retry of the same args. */
export function revisionCall<A extends object>(
  name: string,
  args: A,
  intent: Pick<Intent, "id">,
): MutationCall {
  return keyedCall(name, args, intent, "revision");
}

/** A save that sets one date's override, its `overrideId` kept by a retry of the same args. */
export function overrideCall<A extends object>(
  name: string,
  args: A,
  intent: Pick<Intent, "id">,
): MutationCall {
  return keyedCall(name, args, intent, "override");
}
