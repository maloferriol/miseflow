import { fits, normalize, subtract, type Timeline } from "./timeline.ts";
import {
  SchedulerInputError,
  taskKey,
  type Interval,
  type Minute,
  type Placement,
  type Plan,
  type PlanningModel,
  type TaskKey,
  type Unplaced,
  type UnplacedReason,
} from "./types.ts";

const GRID = 5;
const PLACEHOLDER_ACTIVE = 10;

/** One active stretch of a Task, as an offset from the Task's start. */
interface Stretch {
  offset: number;
  minutes: number;
}

interface Prepared {
  key: TaskKey;
  duration: number;
  stretches: Stretch[];
  approximate: boolean;
  lower: Minute;
}

const roundUp = (minutes: number) => Math.ceil(minutes / GRID) * GRID;
const floorGrid = (minute: Minute) => Math.floor(minute / GRID) * GRID;
const ceilGrid = (minute: Minute) => Math.ceil(minute / GRID) * GRID;
const byKey = <T extends { key: TaskKey }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function prepare(model: PlanningModel): Prepared[] {
  return model.tasks.map((task) => {
    if (task.steps.length === 0) throw new SchedulerInputError("EmptyTask", "A Task needs at least one Step");
    const key = taskKey(task.owner, task.steps[0]!.stepId);
    let offset = 0;
    let approximate = false;
    const stretches: Stretch[] = [];
    for (const s of task.steps) {
      for (const minutes of [s.activeMinutes, s.passiveMinutes]) {
        if (minutes !== null && !(Number.isFinite(minutes) && minutes >= 0)) {
          throw new SchedulerInputError("InvalidDuration", `Step ${s.stepId} of ${key} has duration ${minutes}`, [key]);
        }
      }
      const passive = s.passiveMinutes === null ? 0 : roundUp(s.passiveMinutes);
      // No duration at all: a 10-minute active placeholder. Passive only: active 0.
      const unknown = s.activeMinutes === null && passive === 0;
      if (unknown) approximate = true;
      const active = unknown ? PLACEHOLDER_ACTIVE : roundUp(s.activeMinutes ?? 0);
      if (active > 0) stretches.push({ offset, minutes: active });
      offset += active + passive;
    }
    return {
      key,
      duration: offset,
      stretches,
      approximate,
      lower: task.earliestStart ?? model.service.dayStart,
    };
  });
}

function fitsAt(free: Timeline, task: Prepared, start: Minute): boolean {
  return task.stretches.every((s) => fits(free, start + s.offset, start + s.offset + s.minutes));
}

function latestFit(free: Timeline, task: Prepared, lower: Minute, upper: Minute): Minute | null {
  for (let start = floorGrid(upper - task.duration); start >= ceilGrid(lower); start -= GRID) {
    if (fitsAt(free, task, start)) return start;
  }
  return null;
}

/** The previous start if it still fits, else the nearest start that does (the later one on a tie). */
function nearestFit(free: Timeline, task: Prepared, lower: Minute, upper: Minute, previous: Minute): Minute | null {
  const lo = ceilGrid(lower);
  const hi = floorGrid(upper - task.duration);
  if (hi < lo) return null;
  const from = Math.min(Math.max(Math.round(previous / GRID) * GRID, lo), hi);
  const reach = Math.max(hi - from, from - lo);
  for (let d = 0; d <= reach; d += GRID) {
    if (from + d <= hi && fitsAt(free, task, from + d)) return from + d;
    if (d > 0 && from - d >= lo && fitsAt(free, task, from - d)) return from - d;
  }
  return null;
}

function occupy(free: Timeline, task: Prepared, start: Minute): Timeline {
  for (const s of task.stretches) free = subtract(free, start + s.offset, start + s.offset + s.minutes);
  return free;
}

/** Where a Task's predecessors must have finished, and whether a pin sets that limit. */
interface Bound {
  at: Minute;
  pin: TaskKey | null;
}

interface Candidate {
  key: TaskKey;
  upper: Bound;
  previous: Minute | undefined;
}

/** Placement order among eligible Tasks: true when `a` goes before `b`. */
function before(a: Candidate, b: Candidate): boolean {
  if ((a.previous === undefined) !== (b.previous === undefined)) return a.previous !== undefined;
  if (a.previous !== undefined && b.previous !== undefined && a.previous !== b.previous) return a.previous > b.previous;
  if (a.upper.at !== b.upper.at) return a.upper.at > b.upper.at;
  return a.key < b.key;
}

/**
 * Plans a whole Service backward from Service time. Pure and deterministic.
 * Throws `SchedulerInputError` for input it cannot plan: not exactly one Cook, an empty or
 * duplicate Task, a negative or non-finite duration, a link to an unknown Task, a duplicate previous
 * placement, or a dependency cycle.
 */
export function schedule(model: PlanningModel): Plan {
  if (model.cooks.length !== 1) {
    throw new SchedulerInputError("CookCount", `Expected exactly one Cook, got ${model.cooks.length}`);
  }
  const cook = model.cooks[0]!;
  const cookFree = normalize(cook.free);
  const tasks = new Map<TaskKey, Prepared>();
  for (const task of prepare(model)) {
    if (tasks.has(task.key)) throw new SchedulerInputError("DuplicateTask", `Duplicate Task ${task.key}`, [task.key]);
    tasks.set(task.key, task);
  }
  const unknown = model.links.flatMap((l) => [l.before, l.after]).filter((k) => !tasks.has(k));
  if (unknown.length > 0) {
    const keys = [...new Set(unknown)].sort();
    throw new SchedulerInputError("UnknownLinkTask", `Link to unknown Task ${keys.join(", ")}`, keys);
  }
  const seenPrevious = new Set<TaskKey>();
  for (const prev of model.previous) {
    if (seenPrevious.has(prev.key)) {
      throw new SchedulerInputError("DuplicatePrevious", `Duplicate previous placement ${prev.key}`, [prev.key]);
    }
    seenPrevious.add(prev.key);
  }

  // successors[k]: Tasks that may start only once k has finished; predecessors is the reverse.
  const successors = new Map<TaskKey, TaskKey[]>([...tasks.keys()].map((k) => [k, []]));
  const predecessors = new Map<TaskKey, TaskKey[]>([...tasks.keys()].map((k) => [k, []]));
  for (const link of model.links) {
    successors.get(link.before)!.push(link.after);
    predecessors.get(link.after)!.push(link.before);
  }
  const waitingOn = new Map([...successors].map(([k, after]) => [k, new Set(after)]));

  // Kahn's check over every link before pins are placed, so a cycle through a pin is caught too.
  const unfinished = new Map([...successors].map(([k, after]) => [k, after.length]));
  const ready = [...unfinished].filter(([, n]) => n === 0).map(([k]) => k);
  const sinksFirst: TaskKey[] = [];
  for (let k = ready.pop(); k !== undefined; k = ready.pop()) {
    unfinished.delete(k);
    sinksFirst.push(k);
    for (const pred of predecessors.get(k)!) {
      const n = unfinished.get(pred)! - 1;
      unfinished.set(pred, n);
      if (n === 0) ready.push(pred);
    }
  }
  if (unfinished.size > 0) {
    const keys = [...unfinished.keys()].sort();
    throw new SchedulerInputError("Cycle", `Dependency cycle among ${keys.join(", ")}`, keys);
  }

  // Previous starts of Tasks that still exist and are not pinned.
  const previousStart = new Map<TaskKey, Minute>();
  for (const prev of model.previous) if (!prev.pinned && tasks.has(prev.key)) previousStart.set(prev.key, prev.start);

  const bounds = new Map<TaskKey, Bound>();
  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];
  const pins: { task: Prepared; start: Minute }[] = [];
  let free = cookFree;

  const done = (key: TaskKey) => {
    waitingOn.delete(key);
    for (const pred of predecessors.get(key)!) waitingOn.get(pred)?.delete(key);
  };
  const place = (task: Prepared, start: Minute, pinned: boolean) => {
    free = occupy(free, task, start);
    bounds.set(task.key, { at: start, pin: pinned ? task.key : null });
    placements.push({ key: task.key, start, end: start + task.duration, cookId: cook.id, pinned, approximate: task.approximate });
  };
  // Binding upper bound: the earliest successor bound (ties by key), else Service.
  const upperOf = (key: TaskKey): Bound => {
    let best: Bound = { at: model.service.at, pin: null };
    let bestKey: TaskKey | null = null;
    for (const after of successors.get(key)!) {
      const b = bounds.get(after)!;
      if (b.at < best.at || (b.at === best.at && (bestKey === null || after < bestKey))) {
        best = b;
        bestKey = after;
      }
    }
    return best;
  };

  // Pins first: fixed occupants, never searched. A pin for a Task that no longer exists is ignored.
  for (const prev of [...model.previous].sort(byKey)) {
    const task = tasks.get(prev.key);
    if (!prev.pinned || !task) continue;
    place(task, prev.start, true);
    pins.push({ task, start: prev.start });
    done(task.key);
  }

  // Earliest start set by pins, forward in dependency order: no Task starts before a pin anywhere
  // upstream has finished, passive time and the Tasks in between included. Ties go to the lower
  // pin key. Only pins propagate: a predecessor's own lower bound does not push its successors
  // (decision 2), since that predecessor may end up Unplaced.
  const pinStart = new Map(pins.map((p) => [p.task.key, p.start]));
  const pinBound = new Map<TaskKey, { at: Minute; pin: TaskKey } | null>();
  for (const key of [...sinksFirst].reverse()) {
    let best: { at: Minute; pin: TaskKey } | null = null;
    for (const before of predecessors.get(key)!) {
      const pinned = pinStart.get(before);
      const from = pinned !== undefined ? { at: pinned, pin: before } : pinBound.get(before)!;
      if (!from) continue;
      const end = from.at + tasks.get(before)!.duration;
      if (!best || end > best.at || (end === best.at && from.pin < best.pin)) best = { at: end, pin: from.pin };
    }
    pinBound.set(key, best);
  }
  // Binding lower bound: the pin bound when it is later than the Task's own lower bound.
  const lowerOf = (task: Prepared): Bound => {
    const bound = pinBound.get(task.key)!;
    return bound && bound.at > task.lower ? bound : { at: task.lower, pin: null };
  };

  const reasonFor = (task: Prepared, lowerBound: Bound, upper: Bound): UnplacedReason => {
    const lower = lowerBound.at;
    const window: Interval = { start: lower, end: upper.at };
    if (upper.pin !== null) return { kind: "BlockedByPin", pin: upper.pin, searched: window };
    if (lowerBound.pin !== null) return { kind: "BlockedByPin", pin: lowerBound.pin, searched: window };
    if (upper.at - lower < task.duration) return { kind: "WindowTooTight", minutesNeeded: task.duration, window };
    for (const pin of pins) {
      const pinStart = pin.start;
      if (pinStart >= upper.at || pinStart + pin.task.duration <= lower) continue;
      // Would the Task fit with this pin's active time given back?
      let without = cookFree;
      for (const p of placements) if (p.key !== pin.task.key) without = occupy(without, tasks.get(p.key)!, p.start);
      if (latestFit(without, task, lower, upper.at) !== null) return { kind: "BlockedByPin", pin: pin.task.key, searched: window };
    }
    return { kind: "NoAvailability", minutesNeeded: task.duration, searched: window };
  };

  while (waitingOn.size > 0) {
    // Eligible: every successor is done. Tasks with a previous start first, latest previous start
    // first; then latest upper bound; then key.
    let next: Candidate | null = null;
    for (const [key, waiting] of waitingOn) {
      if (waiting.size > 0) continue;
      const candidate = { key, upper: upperOf(key), previous: previousStart.get(key) };
      if (!next || before(candidate, next)) next = candidate;
    }
    // The graph is acyclic (checked above), so some Task is always eligible.
    const { key, upper, previous } = next!;
    const task = tasks.get(key)!;
    const lower = lowerOf(task);

    const start =
      previous === undefined
        ? latestFit(free, task, lower.at, upper.at)
        : nearestFit(free, task, lower.at, upper.at, previous);
    if (start !== null) {
      place(task, start, false);
    } else {
      unplaced.push({ key, reason: reasonFor(task, lower, upper) });
      // Predecessors are planned against this Task's own limit: the next placed successor, or Service.
      bounds.set(key, upper);
    }
    done(key);
  }
  return { placements: placements.sort(byKey), unplaced: unplaced.sort(byKey) };
}
