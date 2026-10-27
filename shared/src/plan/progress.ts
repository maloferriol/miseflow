import type { Owner } from "../scheduler/types.ts";

// Pure: Step progress from the append-only `step_events` (ADR 0010: a Step's state is its latest event).

export type StepEvent = {
  id: string;
  owner: Owner;
  stepId: string;
  kind: "done" | "undone";
  at: Date;
};
/** `doneAt`: the first tick of the trailing run of `done` events (D4), so a second tick moves nothing. */
export type StepState = { done: boolean; doneAt: Date | null };

/** "dish:<dishId>:<stepId>" or "batch:<batchId>:<stepId>". */
export function stepKey(owner: Owner, stepId: string): string {
  return owner.kind === "dish"
    ? `dish:${owner.dishId}:${stepId}`
    : `batch:${owner.batchId}:${stepId}`;
}

/** Each Step's state, by `stepKey`. A Step with no events has no entry (not done). Input order doesn't matter. */
export function stepStates(events: StepEvent[]): Map<string, StepState> {
  // By time, then id: the id only makes the order deterministic (D3 keeps `at` increasing per Step).
  const sorted = [...events].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const states = new Map<string, StepState>();
  for (const e of sorted) {
    const key = stepKey(e.owner, e.stepId);
    const state = states.get(key);
    if (e.kind === "undone") states.set(key, { done: false, doneAt: null });
    else if (!state?.done) states.set(key, { done: true, doneAt: e.at });
  }
  return states;
}
