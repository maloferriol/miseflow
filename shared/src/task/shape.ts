import type { Minute } from "../scheduler/types.ts";

// Pure: how a Task's Steps become its timing, for the scheduler and everything that reads its
// Plan. Steps run back to back, each with its active part first and then its passive part.

/** The scheduler's grid, in minutes. */
export const GRID = 5;
/** The active time a Step with no duration at all counts for. */
const PLACEHOLDER_ACTIVE = 10;

/** A duration rounded up to the grid. */
export const roundUpToGrid = (minutes: number) => Math.ceil(minutes / GRID) * GRID;
export const floorToGrid = (minute: Minute) => Math.floor(minute / GRID) * GRID;
export const ceilToGrid = (minute: Minute) => Math.ceil(minute / GRID) * GRID;
export const nearestOnGrid = (minute: Minute) => Math.round(minute / GRID) * GRID;

/** A Step's durations as the Recipe stores them; null when not set. */
export type StepTime = { activeMinutes: number | null; passiveMinutes: number | null };

/** One active stretch of a Task, as an offset from the Task's start. */
export type ActiveStretch = { offset: number; minutes: number };

/** A Task's timing, on the grid. */
export type TaskShape = {
  duration: number;
  /** Each Step's active part, in order, leaving out the empty ones. */
  stretches: ActiveStretch[];
  /** Each Step's active and passive time, rounded, in Step order. */
  steps: { activeMinutes: number; passiveMinutes: number }[];
  activeMinutes: number;
  passiveMinutes: number;
  /** The last Step's passive time. */
  trailingPassiveMinutes: number;
  /** A Step has neither active nor passive time. */
  approximate: boolean;
  /** When the last active time ends, from the Task's start. */
  dueOffset: number;
};

/**
 * When a Task is due, from its start: when its last Step's active time ends, since passive time
 * after it runs by itself (#88 D5).
 */
export const dueOffset = (
  task: Pick<TaskShape, "activeMinutes" | "passiveMinutes" | "trailingPassiveMinutes">,
) => task.activeMinutes + task.passiveMinutes - task.trailingPassiveMinutes;

/**
 * A Task's timing from its Steps, in order. A Step's passive time is rounded up, 0 when not set.
 * With no active time and no passive time it counts 10 active minutes and makes the Task
 * approximate; passive only, it has no active time. Otherwise its active time is rounded up.
 */
export function taskShape(steps: readonly StepTime[]): TaskShape {
  let offset = 0;
  let activeMinutes = 0;
  let passiveMinutes = 0;
  let approximate = false;
  const stretches: ActiveStretch[] = [];
  const parts = steps.map((s) => {
    const passive = s.passiveMinutes === null ? 0 : roundUpToGrid(s.passiveMinutes);
    const unknown = s.activeMinutes === null && passive === 0;
    if (unknown) approximate = true;
    const active = unknown ? PLACEHOLDER_ACTIVE : roundUpToGrid(s.activeMinutes ?? 0);
    if (active > 0) stretches.push({ offset, minutes: active });
    offset += active + passive;
    activeMinutes += active;
    passiveMinutes += passive;
    return { activeMinutes: active, passiveMinutes: passive };
  });
  const totals = {
    activeMinutes,
    passiveMinutes,
    trailingPassiveMinutes: parts.at(-1)?.passiveMinutes ?? 0,
  };
  return {
    duration: offset,
    stretches,
    steps: parts,
    ...totals,
    approximate,
    dueOffset: dueOffset(totals),
  };
}
