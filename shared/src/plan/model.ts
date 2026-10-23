import type { Interval } from "../scheduler/types.ts";
import { addDays, type LocalDate, weekdayOf, zonedMinute } from "./time.ts";

// Pure: the rows a re-plan reads, turned into the scheduler's PlanningModel. No drizzle here.

/** Minutes of day, `end > start`; `end` may be 1440 (midnight). */
export type Hours = { start: number; end: number };
export type WeeklyHours = { weekday: number } & Hours;
/** `hours: null`: not available that date. */
export type OverrideHours = { date: LocalDate; hours: Hours | null };

/** The Cook's free time from `from` to `to` (inclusive): each date's override if any, else its weekday's hours. */
export function freeIntervals(
  weekly: WeeklyHours[],
  overrides: OverrideHours[],
  from: LocalDate,
  to: LocalDate,
  timeZone: string,
): Interval[] {
  const byDate = new Map(overrides.map((o) => [o.date, o.hours]));
  const out: Interval[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const hours = byDate.has(date)
      ? [byDate.get(date)].filter((h): h is Hours => h != null)
      : weekly.filter((w) => w.weekday === weekdayOf(date));
    for (const h of hours) {
      out.push({ start: zonedMinute(date, h.start, timeZone), end: zonedMinute(date, h.end, timeZone) });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
