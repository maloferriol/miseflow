// The Today checklist's decisions (ADR 0011): pure functions the hook and the view pass through.
import type { Plan, PlanTask } from "./api.ts";
import type { Intent } from "./intent.ts";
import type { MutationCall } from "./menu-screen.ts";
import { shortDay } from "./plan-display.ts";

/** One prep day of the Plan, its Tasks by start. */
export type PlanDay = Plan["days"][number];

/** `now`'s date in the kitchen's zone ("2026-10-29"); en-CA formats as YYYY-MM-DD. */
export const todayIn = (timeZone: string, now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);

/** The day named in the link (`?day=2026-10-29`), or null when it names none. */
export const dayFromLink = (search: string) => new URLSearchParams(search).get("day");

/** The link's query string with `day` set to `date`, its other params kept. */
export function linkWithDay(search: string, date: string) {
  const params = new URLSearchParams(search);
  params.set("day", date);
  return `?${params}`;
}

/**
 * The day the checklist shows: the chosen day, else the earliest day with a behind Task, else
 * today in the kitchen's zone if it has Tasks, else the first. Undefined until the Plan has loaded,
 * or when it has no days.
 */
export function shownDay(plan: Plan | undefined, chosen: string | null, now: Date) {
  if (!plan) return undefined;
  const { days } = plan;
  const today = todayIn(plan.timeZone, now);
  return (
    days.find((d) => d.date === chosen) ??
    days.find((d) => d.tasks.some((t) => t.behind)) ??
    days.find((d) => d.date === today) ??
    days[0]
  );
}

/** When a behind Task was due, as seen on `date`'s tab: "18:00", or "Thu 18:00" on another day. */
export const wasDue = (behind: NonNullable<PlanTask["behind"]>, date: string) =>
  behind.dueDate === date ? behind.dueAt : `${shortDay(behind.dueDate)} ${behind.dueAt}`;

/** One Step's tick box, across every day's tab. */
export const tickKey = (task: Pick<PlanTask, "key">, stepId: string) => `${task.key}:${stepId}`;

/** A tick on its way to the server: the box it's for, and whether it ticks or unticks. */
export type Ticking = { key: string; done: boolean };

/** Whether a Step's box shows ticked: the tick on its way, else the Step as the Plan has it. */
export const boxChecked = (ticking: Ticking | null, key: string, done: boolean) =>
  ticking?.key === key ? ticking.done : done;

/** Ticks or unticks one Step, with one mutation and event id per intended tick (ADR 0007). */
export function tickSave(
  serviceId: string,
  task: Pick<PlanTask, "key" | "owner">,
  stepId: string,
  done: boolean,
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = `${tickKey(task, stepId)}:${done}`;
  return {
    id: intent.id(key, "mutation"),
    name: done ? "tickStep" : "untickStep",
    args: { eventId: intent.id(key, "event"), serviceId, owner: task.owner, stepId },
  };
}
