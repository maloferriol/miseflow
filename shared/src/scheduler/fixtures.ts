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
