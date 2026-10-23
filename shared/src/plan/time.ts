import type { Minute } from "../scheduler/types.ts";

// Wall-clock time in the kitchen's IANA time zone, with Intl only (Temporal isn't in Node yet).
// A Minute is whole UTC minutes since the Unix epoch, so it stays one instant across a
// daylight-saving change. Source:
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat

/** "YYYY-MM-DD", a date in the kitchen's zone. */
export type LocalDate = string;

const DAY = 1440;
const formatters = new Map<string, Intl.DateTimeFormat>();

// Throws RangeError for an unknown zone.
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// The wall clock at `minute`, as if it were UTC minutes.
function wallClock(minute: Minute, timeZone: string): number {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(minute * 60_000))
      .map((p) => [p.type, p.value]),
  );
  return (
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) /
    60_000
  );
}

const offsetAt = (minute: Minute, timeZone: string) => wallClock(minute, timeZone) - minute;

function dayNumber(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 60_000 / DAY;
}

function fromDayNumber(day: number): LocalDate {
  return new Date(day * DAY * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return fromDayNumber(dayNumber(date) + n);
}

/** 0 = Sunday … 6 = Saturday, as `availability_weekly`. */
export function weekdayOf(date: LocalDate): number {
  return new Date(dayNumber(date) * DAY * 60_000).getUTCDay();
}

/**
 * The instant of `minuteOfDay` (0–1440) on `date` in `timeZone`. A time that doesn't exist (a
 * spring gap) is the later instant and one that happens twice is the earlier, as Temporal's
 * default "compatible" disambiguation. Source:
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/ZonedDateTime#ambiguity_and_gaps_from_local_time_to_utc_time
 */
export function zonedMinute(date: LocalDate, minuteOfDay: number, timeZone: string): Minute {
  const wall = dayNumber(date) * DAY + minuteOfDay;
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  const valid = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((t) => wallClock(t, timeZone) === wall);
  if (valid.length) return Math.min(...valid);
  // A gap: keep the offset from before the change, which lands after it.
  return wall - before;
}

export function localParts(minute: Minute, timeZone: string): { date: LocalDate; minuteOfDay: number; weekday: number } {
  const wall = wallClock(minute, timeZone);
  const day = Math.floor(wall / DAY);
  const date = fromDayNumber(day);
  return { date, minuteOfDay: wall - day * DAY, weekday: weekdayOf(date) };
}

/** A minute of day (0–1440) as a Postgres `time`; 1440 is "24:00:00", which `time` accepts. */
export function toTimeColumn(minuteOfDay: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:00`;
}

/** A Postgres `time` ("HH:MM[:SS]") as a minute of day; seconds are dropped. */
export function fromTimeColumn(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/** "19:30". */
export function formatMinuteOfDay(minuteOfDay: number): string {
  return toTimeColumn(minuteOfDay).slice(0, 5);
}
