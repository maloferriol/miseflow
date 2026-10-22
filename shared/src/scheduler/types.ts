/**
 * Planning-model input and Plan output for the greedy backward scheduler.
 *
 * Times are integer minutes from an epoch the caller picks, on a 5-minute
 * grid. The scheduler never reads a clock, a time zone or a database.
 */

/** Integer minutes from the caller's epoch, a multiple of 5. */
export type Minute = number;

/** Who a Task belongs to: a Dish or a Batch. */
export type Owner =
  | { kind: "dish"; dishId: string }
  | { kind: "batch"; batchId: string };

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
  /** MVP: exactly one Cook. Free intervals are already expanded by the mapper. */
  cooks: { id: string; free: Interval[] }[];
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
}

export interface TaskSpec {
  owner: Owner;
  /** In order. The Task key uses `steps[0]`. Must not be empty. */
  steps: StepSpec[];
  /** null: a last-minute Task (not before the Service date). Else the make-ahead lower bound. */
  earliestStart: Minute | null;
}

export interface PreviousPlacement {
  key: TaskKey;
  start: Minute;
  cookId: string;
  pinned: boolean;
}

/** Every Task appears in exactly one of the two arrays. Both are sorted by key. */
export interface Plan {
  placements: Placement[];
  unplaced: Unplaced[];
}

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

/** Open union: later tickets add `ShelfLifeExceeded`, `EarliestUseTooLate`, `Outrun`. */
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
  | "DuplicatePrevious";

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
