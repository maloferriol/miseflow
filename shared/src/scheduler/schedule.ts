import { fits, normalize, subtract, type Timeline } from "./timeline.ts";
import { taskKey, type Minute, type Placement, type Plan, type PlanningModel, type TaskKey } from "./types.ts";

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

export function schedule(model: PlanningModel): Plan {
  const cook = model.cooks[0]!;
  let free = normalize(cook.free);
  const tasks = new Map(prepare(model).map((t) => [t.key, t]));

  // successors[k]: Tasks that may start only once k has finished.
  const successors = new Map<TaskKey, TaskKey[]>([...tasks.keys()].map((k) => [k, []]));
  for (const link of model.links) successors.get(link.before)!.push(link.after);
  const waitingOn = new Map([...successors].map(([k, after]) => [k, new Set(after)]));

  const starts = new Map<TaskKey, Minute>();
  const placements: Placement[] = [];
  const upperOf = (key: TaskKey) =>
    successors.get(key)!.reduce((upper, after) => Math.min(upper, starts.get(after)!), model.service.at);

  while (waitingOn.size > 0) {
    // Eligible: every successor is done. Latest upper bound first, then key.
    let next: { key: TaskKey; upper: Minute } | null = null;
    for (const [key, waiting] of waitingOn) {
      if (waiting.size > 0) continue;
      const upper = upperOf(key);
      if (!next || upper > next.upper || (upper === next.upper && key < next.key)) next = { key, upper };
    }
    const { key, upper } = next!;
    const task = tasks.get(key)!;
    waitingOn.delete(key);

    const start = latestFit(free, task, task.lower, upper);
    if (start !== null) {
      for (const s of task.stretches) free = subtract(free, start + s.offset, start + s.offset + s.minutes);
      starts.set(key, start);
      placements.push({
        key,
        start,
        end: start + task.duration,
        cookId: cook.id,
        pinned: false,
        approximate: task.approximate,
      });
    }
    for (const link of model.links) if (link.after === key) waitingOn.get(link.before)?.delete(key);
  }
  return { placements: placements.sort(byKey), unplaced: [] };
}
