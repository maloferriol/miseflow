// Pure: the Plan trouble count on the Plan screen's badge (#90 AC5, spec §6.7).

/**
 * The Unplaced Tasks plus the conflicts, one per row of the Conflicts list. Recipe changed notes
 * don't count: they are out of #90's scope (plan addendum 1, point B).
 */
export function planTrouble(plan: {
  unplaced: readonly unknown[];
  conflicts: readonly unknown[];
}): number {
  return plan.unplaced.length + plan.conflicts.length;
}
