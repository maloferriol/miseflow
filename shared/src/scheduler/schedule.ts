import { fits, normalize, subtract, type Timeline } from "./timeline.ts";
import {
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
    let offset = 0;
    let approximate = false;
    const stretches: Stretch[] = [];
    for (const s of task.steps) {
      const passive = s.passiveMinutes === null ? 0 : roundUp(s.passiveMinutes);
      // No duration at all: a 10-minute active placeholder. Passive only: active 0.
      const unknown = s.activeMinutes === null && passive === 0;
      if (unknown) approximate = true;
      const active = unknown ? PLACEHOLDER_ACTIVE : roundUp(s.activeMinutes ?? 0);
      if (active > 0) stretches.push({ offset, minutes: active });
      offset += active + passive;
    }
    return {
      key: taskKey(task.owner, task.steps[0]!.stepId),
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

function occupy(free: Timeline, task: Prepared, start: Minute): Timeline {
  for (const s of task.stretches) free = subtract(free, start + s.offset, start + s.offset + s.minutes);
  return free;
}

/** Where a Task's predecessors must have finished, and whether a pin sets that limit. */
interface Bound {
  at: Minute;
  pin: TaskKey | null;
}

export function schedule(model: PlanningModel): Plan {
  const cook = model.cooks[0]!;
  const cookFree = normalize(cook.free);
  const tasks = new Map(prepare(model).map((t) => [t.key, t]));

  // successors[k]: Tasks that may start only once k has finished; predecessors is the reverse.
  const successors = new Map<TaskKey, TaskKey[]>([...tasks.keys()].map((k) => [k, []]));
  const predecessors = new Map<TaskKey, TaskKey[]>([...tasks.keys()].map((k) => [k, []]));
  for (const link of model.links) {
    successors.get(link.before)!.push(link.after);
    predecessors.get(link.after)!.push(link.before);
  }
  const waitingOn = new Map([...successors].map(([k, after]) => [k, new Set(after)]));

  const bounds = new Map<TaskKey, Bound>();
  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];
  const pins: { task: Prepared; start: Minute }[] = [];
  let free = cookFree;

  const done = (key: TaskKey) => {
    waitingOn.delete(key);
    for (const before of predecessors.get(key)!) waitingOn.get(before)?.delete(key);
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
      if (b.at < best.at || (b.at === best.at && bestKey !== null && after < bestKey)) {
        best = b;
        bestKey = after;
      }
    }
    return best;
  };

  // Pins first: fixed occupants, never searched. A pin for a Task that no longer exists is ignored.
  for (const prev of [...model.previous].sort(byKey)) {
    const task = tasks.get(prev.key);
    if (!prev.pinned || !task || bounds.has(task.key)) continue;
    place(task, prev.start, true);
    pins.push({ task, start: prev.start });
    done(task.key);
  }

  const reasonFor = (task: Prepared, lower: Minute, upper: Bound): UnplacedReason => {
    const window: Interval = { start: lower, end: upper.at };
    if (upper.pin !== null) return { kind: "BlockedByPin", pin: upper.pin, searched: window };
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
    // Eligible: every successor is done. Latest upper bound first, then key.
    let next: { key: TaskKey; upper: Bound } | null = null;
    for (const [key, waiting] of waitingOn) {
      if (waiting.size > 0) continue;
      const upper = upperOf(key);
      if (!next || upper.at > next.upper.at || (upper.at === next.upper.at && key < next.key)) next = { key, upper };
    }
    const { key, upper } = next!;
    const task = tasks.get(key)!;

    const start = latestFit(free, task, task.lower, upper.at);
    if (start !== null) {
      place(task, start, false);
    } else {
      unplaced.push({ key, reason: reasonFor(task, task.lower, upper) });
      // Predecessors are planned against this Task's own limit: the next placed successor, or Service.
      bounds.set(key, upper);
    }
    done(key);
  }
  return { placements: placements.sort(byKey), unplaced: unplaced.sort(byKey) };
}
