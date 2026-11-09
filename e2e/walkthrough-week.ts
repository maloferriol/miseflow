import { addDays, weekdayOf } from "../shared/src/plan/time.ts";

// ADR 0004's walkthrough week (Service Sat 31 Oct 2026, prep from Wed 28 Oct), moved to the first
// Saturday at least two weeks after today. The server reads date overrides from 7 days ago on and
// measures progress against its real clock, so a fixed 2026 week stops matching once it is past.
// Everything else about the walkthrough is unchanged; only the calendar dates move.
const today = new Date().toISOString().slice(0, 10);
const fortnight = addDays(today, 14);
const saturday = addDays(fortnight, (6 - weekdayOf(fortnight) + 7) % 7);

export const week = {
  wednesday: addDays(saturday, -3),
  thursday: addDays(saturday, -2),
  friday: addDays(saturday, -1),
  saturday,
};

/** "Thursday 29 October", as the web app heads a kitchen-zone date. */
export function heading(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    at.toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}`;
}
