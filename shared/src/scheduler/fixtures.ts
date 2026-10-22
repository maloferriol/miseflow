/**
 * Test-only builders. Not exported from the scheduler barrel.
 * Day 0 is the epoch; `at(1, 18, 0)` is day 1 at 18:00.
 */
import type { Interval, Minute, PlanningModel, PreviousPlacement, StepSpec, TaskSpec } from "./types.ts";

export function at(day: number, hours: number, minutes: number): Minute {
  return day * 1440 + hours * 60 + minutes;
}

export function step(stepId: string, activeMinutes: number | null, passiveMinutes: number | null = 0): StepSpec {
  return { stepId, activeMinutes, passiveMinutes };
}

export function dishTask(dishId: string, steps: StepSpec[], earliestStart: Minute | null = null): TaskSpec {
  return { owner: { kind: "dish", dishId }, steps, earliestStart };
}

export function batchTask(batchId: string, steps: StepSpec[], earliestStart: Minute | null = null): TaskSpec {
  return { owner: { kind: "batch", batchId }, steps, earliestStart };
}

export function model(input: {
  service: { dayStart: Minute; at: Minute };
  free: Interval[];
  tasks: TaskSpec[];
  links?: { before: string; after: string }[];
  previous?: PreviousPlacement[];
}): PlanningModel {
  return {
    service: input.service,
    cooks: [{ id: "c1", free: input.free }],
    tasks: input.tasks,
    links: input.links ?? [],
    previous: input.previous ?? [],
  };
}

/** Deterministic LCG (Numerical Recipes constants), so generated Services are reproducible. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * A Service on day `days` at 19:30 with `n` Tasks: Dishes and Batches, nine in ten prep-ahead
 * (from day 0 or 1), about half of them linked to a later Task, and one Cook free 08:00–22:00 daily.
 */
export function generatedService(n: number, seed = 1, days = 7): PlanningModel {
  const random = lcg(seed);
  const pick = (max: number) => Math.floor(random() * max);
  const free = Array.from({ length: days + 1 }, (_, day) => ({ start: at(day, 8, 0), end: at(day, 22, 0) }));
  const tasks: TaskSpec[] = [];
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const owner = `o${String(i).padStart(4, "0")}`;
    const steps = Array.from({ length: 1 + pick(2) }, (_, s) =>
      step(`s${s}`, random() < 0.05 ? null : 5 * pick(5), random() < 0.3 ? 5 * pick(24) : 0),
    );
    const earliest = random() < 0.9 ? at(pick(2), 8, 0) : null;
    tasks.push(i % 3 === 0 ? batchTask(owner, steps, earliest) : dishTask(owner, steps, earliest));
    keys.push(`${i % 3 === 0 ? "batch" : "dish"}:${owner}:s0`);
  }
  const links = [];
  for (let i = 0; i < n - 1; i++) {
    if (random() < 0.5) links.push({ before: keys[i]!, after: keys[i + 1 + pick(Math.min(10, n - i - 1))]! });
  }
  return model({ service: { dayStart: at(days, 0, 0), at: at(days, 19, 30) }, free, tasks, links });
}
