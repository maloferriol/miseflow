// The Menu screen's decisions (ADR 0011): pure functions the hooks and the views pass through.
import { minuteOfDay, timeValue } from "./time-of-day.ts";

/** The Guests field as a guest count, or null when it holds no whole number above zero. */
export function parseGuests(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const guests = Number(text);
  return guests > 0 ? guests : null;
}

/** A Service's date and time of day: a minute of day, or null for the kitchen's default. */
export type ServiceInput = { date: string; time: number | null };

/**
 * The Service form's fields as what to save, or null when there is nothing to save: no date,
 * or a time that isn't a time of day.
 */
export function serviceInput(date: string, time: string): ServiceInput | null {
  if (!date) return null;
  if (!time) return { date, time: null };
  const minute = minuteOfDay(time);
  // A time of day writes back as itself; "24:00" or "19:60" don't.
  return minute !== null && timeValue(minute) === time.slice(0, 5) ? { date, time: minute } : null;
}
