import { planTrouble } from "@miseflow/shared/src/plan/trouble.ts";
import type { Plan } from "./api.ts";

// Pure: which quick fixes an Unplaced Task offers on the Plan screen (#90, spec §6.5), and the
// Plan trouble badge's text. PlanScreen only renders them.

export type UnplacedItem = Omit<Plan["unplaced"][number], "key" | "sentence">;
type Owner = UnplacedItem["blockingPin"] extends infer P ? (P extends { owner: infer O } ? O : never) : never;

export type QuickFix = {
  label: string;
  /** The mutation and its args. */
  name: "giveCookMoreTime" | "unpinTask" | "removeDish";
  args: Record<string, unknown>;
  /** Asked before the mutation, or null (owner decision 6: only before removing a Dish). */
  confirm: string | null;
};

/**
 * "Give the Cook more time" (not for `WindowTooTight`, owner decision 3), "Unpin <label>" for the
 * pin that leaves no room, then one "Remove <Dish>" per Dish the Task's Dish or Batch feeds
 * (owner decision 4). `newId` makes the new override's id, once per render of the fixes.
 */
export function quickFixes(serviceId: string, item: UnplacedItem, newId: () => string = () => crypto.randomUUID()): QuickFix[] {
  const owner: Owner = item.batch ? { kind: "batch", batchId: item.batch.id } : { kind: "dish", dishId: item.dish!.id };
  const fixes: QuickFix[] = [];
  if (item.moreTime) fixes.push({ label: "Give the Cook more time", name: "giveCookMoreTime", args: { serviceId, owner, firstStepId: item.steps[0]!.id, overrideId: newId() }, confirm: null });
  const pin = item.blockingPin;
  if (pin) fixes.push({ label: `Unpin ${pin.label}`, name: "unpinTask", args: { serviceId, owner: pin.owner, firstStepId: pin.firstStepId }, confirm: null });
  for (const dish of item.dishes)
    fixes.push({ label: `Remove ${dish.name}`, name: "removeDish", args: { dishId: dish.id }, confirm: `Remove ${dish.name} from the Menu?` });
  return fixes;
}

/** "Plan trouble: 2", or null when there is none (the badge is hidden). */
export function troubleBadge(plan: Parameters<typeof planTrouble>[0]): string | null {
  const n = planTrouble(plan);
  return n ? `Plan trouble: ${n}` : null;
}
