// The Availability screen's decisions (ADR 0011): pure functions the hook and the view pass through.
import type { Availability } from "./api.ts";
import type { Intent } from "./intent.ts";
import { type MutationCall, overrideCall } from "./mutation-call.ts";
import { minuteOfDay, timeValue } from "./time-of-day.ts";

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** A form's fields, as `FormData` reads them. */
type Fields = Pick<FormData, "get">;

/** A "To" field as a minute of day, or null when empty. "To 00:00" means until midnight. */
export function endOfDay(value: FormDataEntryValue | null) {
  const m = minuteOfDay(value);
  return m === 0 ? 1440 : m;
}

/** One weekday's hours, in minutes of day in the kitchen's time zone. */
export type WeeklyHours = { weekday: number; start: number; end: number };

/** The default Service time form's field as a minute of day, or null when it is empty. */
export function defaultServiceTimeInput(form: Fields) {
  return minuteOfDay(form.get("defaultServiceTime"));
}

/** The weekday's saved hours, or undefined when the Cook isn't available that day. */
export function weekdayHours(weekly: Availability["weekly"], weekday: number) {
  return weekly.find((w) => w.weekday === weekday);
}

/**
 * The week form's fields as the hours to save: each weekday ticked Available with both a From
 * and a To. A ticked day missing either time is left out.
 */
export function weekHours(form: Fields): WeeklyHours[] {
  return WEEKDAYS.flatMap((_, weekday) => {
    if (!form.get(`available-${weekday}`)) return [];
    const start = minuteOfDay(form.get(`from-${weekday}`));
    const end = endOfDay(form.get(`to-${weekday}`));
    return start === null || end === null ? [] : [{ weekday, start, end }];
  });
}

/** A date override: set hours, not available, or back to the weekly hours (removes it). */
export type OverrideInput = {
  date: string;
  availability:
    { kind: "hours"; start: number; end: number } | { kind: "off" } | { kind: "weekly" };
};

/**
 * The date override form's fields as what to save, or null when there is nothing to save: no
 * date, or hours missing a From or a To. Not available wins over any hours.
 */
export function overrideInput(form: Fields): OverrideInput | null {
  const date = String(form.get("date") ?? "");
  if (!date) return null;
  if (form.get("off")) return { date, availability: { kind: "off" } };
  const start = minuteOfDay(form.get("from"));
  const end = endOfDay(form.get("to"));
  return start !== null && end !== null
    ? { date, availability: { kind: "hours", start, end } }
    : null;
}

/** Removes a date's override, so the date goes back to the weekly hours. */
export function removeOverride(date: string): OverrideInput {
  return { date, availability: { kind: "weekly" } };
}

/** A saved override's hours as the list shows them ("19:00–21:00"), or "not available". */
export function overrideHours(override: Availability["overrides"][number]) {
  return override.hours
    ? `${timeValue(override.hours.start)}–${timeValue(override.hours.end)}`
    : "not available";
}

/** Sets the kitchen's default Service time, with one mutation id per intended time. */
export function kitchenSettingsSave(
  defaultServiceTime: number,
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify(["setKitchenSettings", defaultServiceTime]);
  return {
    id: intent.id(key, "mutation"),
    name: "setKitchenSettings",
    args: { defaultServiceTime },
  };
}

/** Replaces the Cook's weekly hours. A retry of the same hours keeps each row's id. */
export function weeklyAvailabilitySave(
  hours: WeeklyHours[],
  intent: Pick<Intent, "id">,
): MutationCall {
  const key = JSON.stringify(["setWeeklyAvailability", hours]);
  return {
    id: intent.id(key, "mutation"),
    name: "setWeeklyAvailability",
    args: {
      hours: hours.map((h) => ({ availabilityId: intent.id(key, `row-${h.weekday}`), ...h })),
    },
  };
}

/** Sets or removes one date's override. A retry of the same override keeps its id. */
export function availabilityOverrideSave(
  input: OverrideInput,
  intent: Pick<Intent, "id">,
): MutationCall {
  return overrideCall("setAvailabilityOverride", input, intent);
}
