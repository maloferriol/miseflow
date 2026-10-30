import { nearestOnGrid } from "../task/shape.ts";
import type { Interval, Minute, PlanningModel } from "../scheduler/types.ts";
import { addDays, type LocalDate, localParts, zonedMinute } from "./time.ts";

// Pure: the Gantt chart's time axis (ADR 0009), real time to time with the nights removed and back,
// with no drawing in it. Owner decision B1 (#89): every date from the Service's earliest make-ahead
// date to the Service date is a segment. A date with Availability spans its hours, and a date
// without spans the other dates' envelope and is shaded not available; either is widened to cover
// any placed Task's active time on it. Between segments, a night is a seam of fixed width, mapped
// linearly so the mapping inverts. Inside a segment one axis unit is one minute.

/** One date's stretch of the axis. `offset`: where it starts on the axis. `free`: its Availability. */
export type Segment = {
  date: LocalDate;
  start: Minute;
  end: Minute;
  available: boolean;
  free: Interval[];
  offset: number;
};

export type Axis = { segments: Segment[]; seam: number; width: number };

export type AxisInput = {
  /** First and last date, in the kitchen's zone. */
  from: LocalDate;
  to: LocalDate;
  /** The Cook's free intervals. */
  free: Interval[];
  /** What must show inside a segment: each placed Task's active time, the Service time. */
  placed: Interval[];
  timeZone: string;
  /** A night's width in axis units. */
  seam?: number;
};

const DEFAULT_SEAM = 60;
// With no Availability on any date, a date spans 09:00 to 22:00.
const FALLBACK = { start: 9 * 60, end: 22 * 60 };

/** The minute of day an instant ends on `date`: an end at the next midnight is 1440. */
const endOfDay = (end: Minute, date: LocalDate, timeZone: string) => {
  const p = localParts(end, timeZone);
  return p.date === date ? p.minuteOfDay : 1440;
};

export function buildAxis({
  from,
  to,
  free,
  placed,
  timeZone,
  seam = DEFAULT_SEAM,
}: AxisInput): Axis {
  const dateOf = (m: Minute) => localParts(m, timeZone).date;
  const dates: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  const freeOn = new Map<LocalDate, Interval[]>();
  for (const i of free) {
    const d = dateOf(i.start);
    freeOn.set(d, [...(freeOn.get(d) ?? []), i]);
  }
  // The envelope of the dates with Availability, as minutes of day.
  let envelope: { start: number; end: number } | null = null;
  for (const [d, list] of freeOn) {
    const start = Math.min(...list.map((i) => localParts(i.start, timeZone).minuteOfDay));
    const end = Math.max(...list.map((i) => endOfDay(i.end, d, timeZone)));
    envelope = envelope
      ? { start: Math.min(envelope.start, start), end: Math.max(envelope.end, end) }
      : { start, end };
  }
  const hoursOf = envelope ?? FALLBACK;

  const segments: Omit<Segment, "offset">[] = dates.map((date) => {
    const list = freeOn.get(date);
    const hours = list?.length
      ? { start: Math.min(...list.map((i) => i.start)), end: Math.max(...list.map((i) => i.end)) }
      : {
          start: zonedMinute(date, hoursOf.start, timeZone),
          end: zonedMinute(date, hoursOf.end, timeZone),
        };
    for (const p of placed) {
      if (dateOf(p.start) !== date) continue;
      hours.start = Math.min(hours.start, p.start);
      hours.end = Math.max(hours.end, p.end);
    }
    return { date, ...hours, available: Boolean(list?.length), free: list ?? [] };
  });
  // A Task across midnight can make two dates touch: they share one segment.
  const merged: Omit<Segment, "offset">[] = [];
  for (const s of segments) {
    const last = merged.at(-1);
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      last.available ||= s.available;
      last.free = [...last.free, ...s.free];
    } else merged.push({ ...s });
  }

  let offset = 0;
  const out: Segment[] = merged.map((s, i) => {
    const segment = { ...s, offset };
    offset += s.end - s.start + (i < merged.length - 1 ? seam : 0);
    return segment;
  });
  return { segments: out, seam, width: offset };
}

/** Where `minute` falls on the axis. Before the first and after the last segment it runs on 1:1. */
export function toAxis(axis: Axis, minute: Minute): number {
  const { segments, seam } = axis;
  const first = segments[0];
  if (minute < first.start) return first.offset - (first.start - minute);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (minute <= s.end) return s.offset + (minute - s.start);
    const next = segments[i + 1];
    if (next && minute < next.start)
      return s.offset + (s.end - s.start) + ((minute - s.end) / (next.start - s.end)) * seam;
  }
  const last = segments.at(-1)!;
  return last.offset + (minute - last.start);
}

/** The instant at axis position `x`: the inverse of `toAxis`. Not snapped. */
export function fromAxis(axis: Axis, x: number): Minute {
  const { segments, seam } = axis;
  const first = segments[0];
  if (x < first.offset) return first.start - (first.offset - x);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const length = s.end - s.start;
    if (x <= s.offset + length) return s.start + (x - s.offset);
    const next = segments[i + 1];
    if (next && x < next.offset)
      return s.end + ((x - s.offset - length) / seam) * (next.start - s.end);
  }
  const last = segments.at(-1)!;
  return last.start + (x - last.offset);
}

/** The nearest minute on the scheduler's grid. */
export const snap5 = (minute: number): Minute => nearestOnGrid(minute);

export type BarPart = { from: number; to: number };

/** A Task's bar on the axis: its active part, then its passive part straight after; null when empty. */
export function barParts(
  axis: Axis,
  task: { start: Minute; activeMinutes: number; passiveMinutes: number },
): { active: BarPart | null; passive: BarPart | null } {
  const activeEnd = task.start + task.activeMinutes;
  const end = activeEnd + task.passiveMinutes;
  return {
    active:
      task.activeMinutes > 0
        ? { from: toAxis(axis, task.start), to: toAxis(axis, activeEnd) }
        : null,
    passive:
      task.passiveMinutes > 0 ? { from: toAxis(axis, activeEnd), to: toAxis(axis, end) } : null,
  };
}

/** The axis's first date: the earliest make-ahead date or placed Task, else the Service date. */
export function firstDate(model: PlanningModel, starts: Minute[], timeZone: string): LocalDate {
  const earliest = Math.min(
    model.service.dayStart,
    ...starts,
    ...model.tasks.flatMap((t) => (t.earliestStart === null ? [] : [t.earliestStart])),
  );
  return localParts(earliest, timeZone).date;
}
