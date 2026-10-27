import type { Minute, TaskKey } from "../scheduler/types.ts";
import type { TaskInfo } from "./model.ts";
import { stepKey, type StepState } from "./progress.ts";

// Pure: which placed Tasks are behind at `now`, and the later Tasks each one holds up (spec §8).

/** `holdsUp`: every placed, not-done Task downstream through the links, by start, then key. */
export type Behind = { dueAt: Minute; holdsUp: TaskKey[] };

/**
 * A Task is due when its last Step's active time ends: passive time after it runs by itself
 * (#88 D5, owner decision 1). It's behind once `now` is past that and a Step isn't done.
 */
export function behindTasks(input: {
  placements: { key: TaskKey; start: Minute }[];
  tasks: Map<TaskKey, TaskInfo>;
  links: { before: TaskKey; after: TaskKey }[];
  states: Map<string, StepState>;
  now: Minute;
}): Map<TaskKey, Behind> {
  const { tasks, states, now } = input;
  const startOf = new Map(
    input.placements.filter((p) => tasks.has(p.key)).map((p) => [p.key, p.start]),
  );
  const isDone = (task: TaskInfo) =>
    task.stepIds.every((id) => states.get(stepKey(task.owner, id))?.done);
  const successors = new Map<TaskKey, TaskKey[]>();
  for (const l of input.links)
    successors.set(l.before, [...(successors.get(l.before) ?? []), l.after]);

  const out = new Map<TaskKey, Behind>();
  for (const [key, start] of startOf) {
    const task = tasks.get(key)!;
    const dueAt = start + task.activeMinutes + task.passiveMinutes - task.trailingPassiveMinutes;
    if (isDone(task) || !(now > dueAt)) continue;
    const seen = new Set<TaskKey>();
    const queue = [...(successors.get(key) ?? [])];
    for (let k = queue.shift(); k !== undefined; k = queue.shift()) {
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(...(successors.get(k) ?? []));
    }
    const holdsUp = [...seen]
      .filter((k) => startOf.has(k) && !isDone(tasks.get(k)!))
      .sort((a, b) => startOf.get(a)! - startOf.get(b)! || (a < b ? -1 : a > b ? 1 : 0));
    out.set(key, { dueAt, holdsUp });
  }
  return out;
}
