import type { PlanTask } from "./api.ts";

// How the Plan screen, the Today checklist and the printed Plan show a Plan's days and Tasks.
// Dates are kitchen-zone dates ("2026-10-29"), formatted in UTC so the browser's own zone can't
// move them to another day.

const atMidnightUtc = (date: string) => new Date(`${date}T00:00:00Z`);

/** "Thursday 29 October", from a kitchen-zone date. */
export function dayHeading(date: string) {
  const at = atMidnightUtc(date);
  const part = (options: Intl.DateTimeFormatOptions) =>
    at.toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}`;
}

/** "Thu", from a kitchen-zone date. */
export const shortDay = (date: string) =>
  atMidnightUtc(date).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" });

/** "Thu 29 Oct", from a kitchen-zone date: a day on the Gantt chart's axis. */
export const shortDate = (date: string) =>
  atMidnightUtc(date).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** A Dish's name, or a Batch's label ("Chicken stock ×1.5 · for: Velouté, Beurre blanc"). */
export const ownerOf = (task: { dish: { name: string } | null; batch: { label: string } | null }) =>
  task.batch?.label ?? task.dish?.name;

/** "18:20–18:40", with the end's day when it's another day ("21:50–22:00 (Fri)"). */
export const taskTimes = (task: Pick<PlanTask, "start" | "end" | "endDate">, date: string) => {
  const end = task.endDate === date ? task.end : task.end + ` (${shortDay(task.endDate)})`;
  return `${task.start}–${end}`;
};
