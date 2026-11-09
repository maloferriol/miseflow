import type { Mutator, MutatorContext, Tx } from "./define.ts";

/**
 * The one entry point for running a mutation: the `/mutate` route and the tests both call it,
 * inside the transaction the mutation runs in.
 */
export async function applyMutation<Args>(
  tx: Tx,
  mutator: Mutator<Args>,
  args: Args,
  ctx: MutatorContext,
): Promise<void> {
  return await mutator.run(tx, args, ctx);
}
