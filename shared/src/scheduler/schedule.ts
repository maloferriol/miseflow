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
      if (s.activeMinutes === null) approximate = true;
      const active = s.activeMinutes === null ? PLACEHOLDER_ACTIVE : roundUp(s.activeMinutes);
      const passive = s.passiveMinutes === null ? 0 : roundUp(s.passiveMinutes);
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
  const placements: Placement[] = [];
  for (const task of prepare(model).sort(byKey)) {
    const start = latestFit(free, task, task.lower, model.service.at);
    if (start === null) continue;
    for (const s of task.stretches) free = subtract(free, start + s.offset, start + s.offset + s.minutes);
    placements.push({
      key: task.key,
      start,
      end: start + task.duration,
      cookId: cook.id,
      pinned: false,
      approximate: task.approximate,
    });
  }
  return { placements: placements.sort(byKey), unplaced: [] };
}
