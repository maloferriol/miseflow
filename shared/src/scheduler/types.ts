import type { Owner } from "../task/owner.ts";

/**
 * Planning-model input and Plan output for the greedy backward scheduler.
 *
 * Times are integer minutes from an epoch the caller picks, on a 5-minute
 * grid. The scheduler never reads a clock, a time zone or a database.
 */

/** Integer minutes from the caller's epoch, a multiple of 5. */
export type Minute = number;

/** Who a Task belongs to: a Dish or a Batch. */
export type { Owner };

/** ADR 0010 key: `${kind}:${ownerId}:${firstStepId}`. Build it with `taskKey`. */
export type TaskKey = string;

/** Half-open interval `[start, end)`. */
export interface Interval {
  start: Minute;
  end: Minute;
}

export interface PlanningModel {
  /** `dayStart`: start of the Service date. `at`: Service time. */
  service: { dayStart: Minute; at: Minute };
  /** MVP: exactly one Cook. */
  cooks: {
    id: string;
    /** The Cook's Availability expanded to free intervals. */
    free: Interval[];
  }[];
  tasks: TaskSpec[];
  /** Finish-to-start: `after` may start once `before` has finished, passive time included. */
  links: { before: TaskKey; after: TaskKey }[];
  previous: PreviousPlacement[];
}

export interface StepSpec {
  stepId: string;
  /** null: unknown; a 10-minute placeholder is used and the Task is approximate. */
  activeMinutes: number | null;
  /** null: none. */
  passiveMinutes: number | null;
  /** When the Step was ticked done; absent or null: not done. Any minute (not snapped). */
  doneAt?: Minute | null;
}

export interface TaskSpec {
  owner: Owner;
  /** In order. The Task key uses `steps[0]`. Must not be empty. */
  steps: StepSpec[];
  /** null: a last-minute Task (not before the Service date). Else the make-ahead lower bound. */
  earliestStart: Minute | null;
  /**
   * Shelf life once made (ready), in minutes; absent or null: no limit. Checked only when no
   * successor has the same owner: an earlier Step's result feeds the owner's own later Task.
   */
  keepsMinutes?: number | null;
}

export interface PreviousPlacement {
  key: TaskKey;
  start: Minute;
  cookId: string;
  pinned: boolean;
}

/** Every Task appears in exactly one of the first two arrays. Each array is sorted by key. */
export interface Plan {
  placements: Placement[];
  unplaced: Unplaced[];
  /** Placed Tasks that break a rule but stay where they are (spec §3, CONTEXT Pin); by key, then kind. */
  conflicts: Conflict[];
}

/**
 * A placed Task that breaks a rule. A Task is ready at its end, passive time included.
 * `use: null`: the Service itself, for a Task nothing else uses.
 * `Outrun`: the Task starts before a done or in-progress Task it waits for (directly or through
 * the Tasks between) can let it, because that Task was ticked late; `by` is the late Task and
 * `readyAt` its real ready time (#88 owner decision 2).
 */
export type Conflict =
  | {
      key: TaskKey;
      kind: "ShelfLifeExceeded";
      readyAt: Minute;
      keepsUntil: Minute;
      use: TaskKey | null;
      useAt: Minute;
    }
  | { key: TaskKey; kind: "EarliestUseTooLate"; readyAt: Minute; use: TaskKey; useAt: Minute }
  | { key: TaskKey; kind: "Outrun"; by: TaskKey; readyAt: Minute; start: Minute };

export interface Placement {
  key: TaskKey;
  start: Minute;
  end: Minute;
  cookId: string;
  pinned: boolean;
  approximate: boolean;
}

export interface Unplaced {
  key: TaskKey;
  reason: UnplacedReason;
}

/** Open union. Shelf life, earliest use (#87) and `Outrun` (#88) are a `Conflict`, not a reason. */
export type UnplacedReason =
  | { kind: "NoAvailability"; minutesNeeded: number; searched: Interval }
  | { kind: "BlockedByPin"; pin: TaskKey; searched: Interval }
  | { kind: "WindowTooTight"; minutesNeeded: number; window: Interval };

export type SchedulerInputErrorCode =
  | "Cycle"
  | "DuplicateTask"
  | "UnknownLinkTask"
  | "EmptyTask"
  | "CookCount"
  | "InvalidDuration"
  | "DuplicatePrevious"
  | "InvalidTime";

/** Thrown for malformed input the scheduler cannot plan at all. */
export class SchedulerInputError extends Error {
  readonly code: SchedulerInputErrorCode;
  readonly keys: TaskKey[];

  constructor(code: SchedulerInputErrorCode, message: string, keys: TaskKey[] = []) {
    super(message);
    this.name = "SchedulerInputError";
    this.code = code;
    this.keys = keys;
  }
}

export function taskKey(owner: Owner, firstStepId: string): TaskKey {
  return owner.kind === "dish"
    ? `dish:${owner.dishId}:${firstStepId}`
    : `batch:${owner.batchId}:${firstStepId}`;
}
