import type { Minute, Plan, PlanningModel, TaskKey } from "../scheduler/types.ts";
import { formatMinuteOfDay, type LocalDate, localParts } from "./time.ts";

// Pure, for the browser's optimistic re-plan (#89, ADR 0010): the Plan read's model with one Task
// pinned, and a new scheduler run's placements laid over the read. No drizzle here; the shapes are
// the parts of `PlanRead` this needs, so the web can import it.

/** The scheduler's input with the Task `key` moved to `start` and pinned, as `pinTask` stores it. */
export function withPin(model: PlanningModel, key: TaskKey, start: Minute): PlanningModel {
  const cookId = model.previous.find((p) => p.key === key)?.cookId ?? model.cooks[0]!.id;
  return {
    ...model,
    previous: [...model.previous.filter((p) => p.key !== key), { key, start, cookId, pinned: true }],
  };
}

type PlacedTask = {
  key: TaskKey;
  start: string;
  startMinute: number;
  end: string;
  endDate: LocalDate;
  activeMinutes: number;
  passiveMinutes: number;
  pinned: boolean;
};

type Read<T extends PlacedTask> = { timeZone: string; model: PlanningModel; days: { date: LocalDate; tasks: T[] }[] };

/**
 * The read with `plan`'s placements in place of its own: each placed Task's times and pin, the days
 * regrouped in Plan time order (as `readPlan` sorts them), and the model's previous Plan. A Task the
 * read doesn't show placed is left out until the server answers; Unplaced Tasks, conflicts and
 * behind stay as read.
 */
export function applyPlacements<T extends PlacedTask, R extends Read<T>>(read: R, plan: Plan): R {
  const shown = new Map(read.days.flatMap((d) => d.tasks.map((t) => [t.key, t] as const)));
  const clock = (minute: Minute) => {
    const p = localParts(minute, read.timeZone);
    return { date: p.date, time: formatMinuteOfDay(p.minuteOfDay) };
  };
  const placed: { task: T; date: LocalDate }[] = [];
  for (const p of plan.placements) {
    const task = shown.get(p.key);
    if (!task) continue;
    const start = clock(p.start);
    const end = clock(p.start + task.activeMinutes + task.passiveMinutes);
    placed.push({ task: { ...task, start: start.time, startMinute: p.start, end: end.time, endDate: end.date, pinned: p.pinned }, date: start.date });
  }
  placed.sort((a, b) => a.task.startMinute - b.task.startMinute || (a.task.key < b.task.key ? -1 : 1));
  const days: { date: LocalDate; tasks: T[] }[] = [];
  for (const { task, date } of placed) {
    if (days.at(-1)?.date !== date) days.push({ date, tasks: [] });
    days.at(-1)!.tasks.push(task);
  }
  const previous = plan.placements.map(({ key, start, cookId, pinned }) => ({ key, start, cookId, pinned }));
  return { ...read, days, model: { ...read.model, previous } };
}
