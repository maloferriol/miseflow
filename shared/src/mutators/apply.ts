import { replanRegistry } from "../plan/replan.ts";
import type { CallerContext, Mutator, Tx } from "./define.ts";

/**
 * The one entry point for running a mutation: the `/mutate` route and the tests both call it,
 * inside the transaction the mutation runs in. It runs the mutator with a fresh `ctx.replan`,
 * then re-plans each Service the mutator registered, once (ADR 0013). Returns their ids, in id
 * order.
 */
export async function applyMutation<Args>(
  tx: Tx,
  mutator: Mutator<Args>,
  args: Args,
  ctx: CallerContext,
): Promise<string[]> {
  const { replan, finish } = replanRegistry(tx, ctx);
  await mutator.run(tx, args, { ...ctx, replan });
  return await finish();
}
