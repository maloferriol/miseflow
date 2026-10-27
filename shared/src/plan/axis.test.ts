import { describe, expect, it } from "vitest";
import { buildAxis, barParts, fromAxis, snap5, toAxis } from "./axis.ts";
import { freeIntervals } from "./model.ts";
import { zonedMinute } from "./time.ts";

const timeZone = "Europe/Paris";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const at = (date: string, hours: number, minutes = 0) =>
  zonedMinute(date, h(hours, minutes), timeZone);

// The ADR 0004 walkthrough's Availability: Thu and Fri 18:00–22:00, Sat 09:00–19:00, and the
// override Fri 30 Oct 19:00–21:00, from the stock's earliest make-ahead date (Wed) to Service (Sat).
const weekly = [
  { weekday: 4, start: h(18), end: h(22) },
  { weekday: 5, start: h(18), end: h(22) },
  { weekday: 6, start: h(9), end: h(19) },
];
const overrides = [{ date: "2026-10-30", hours: { start: h(19), end: h(21) } }];
const free = freeIntervals(weekly, overrides, "2026-10-28", "2026-10-31", timeZone);
const walkthroughAxis = (placed: { start: number; end: number }[] = []) =>
  buildAxis({ from: "2026-10-28", to: "2026-10-31", free, placed, timeZone });

describe("the Gantt time axis", () => {
  it("AC1: round-trips every 5-minute point inside Availability", () => {
    const axis = walkthroughAxis();
    let points = 0;
    let last = -Infinity;
    for (const interval of free) {
      for (let m = interval.start; m <= interval.end; m += 5) {
        const x = toAxis(axis, m);
        expect(fromAxis(axis, x)).toBe(m);
        expect(x).toBeGreaterThan(last);
        last = x;
        points++;
      }
    }
    // Thu 4 h, Fri 2 h, Sat 10 h: 48 + 24 + 120 intervals of 5 minutes, plus each end.
    expect(points).toBe(49 + 25 + 121);
  });

  it("AC1: a Task with 60 minutes active then 8 hours passive overnight is one bar whose two parts keep their lengths", () => {
    // Thu 21:00: active until 22:00, when Availability ends, then passive through the night to Fri 06:00.
    const start = at("2026-10-29", 21);
    const axis = walkthroughAxis([{ start, end: start + 60 }]);
    const { active, passive } = barParts(axis, { start, activeMinutes: 60, passiveMinutes: 480 });
    expect(passive!.from).toBe(active!.to);
    expect(fromAxis(axis, active!.to) - fromAxis(axis, active!.from)).toBe(60);
    expect(fromAxis(axis, passive!.to) - fromAxis(axis, passive!.from)).toBe(480);
    // The passive part crosses the night seam: its drawn width is less than its 480 minutes.
    expect(passive!.to - passive!.from).toBeLessThan(480);
    expect(active!.to - active!.from).toBe(60);
  });

  it("B1: a date with no Availability spans the other dates' envelope, and a point in a night maps into the seam and back", () => {
    const axis = walkthroughAxis();
    expect(
      axis.segments.map((s) => ({
        date: s.date,
        start: s.start,
        end: s.end,
        available: s.available,
      })),
    ).toEqual([
      // Wednesday has no Availability: 09:00 (Sat's start) to 22:00 (Thu's end).
      {
        date: "2026-10-28",
        start: at("2026-10-28", 9),
        end: at("2026-10-28", 22),
        available: false,
      },
      {
        date: "2026-10-29",
        start: at("2026-10-29", 18),
        end: at("2026-10-29", 22),
        available: true,
      },
      {
        date: "2026-10-30",
        start: at("2026-10-30", 19),
        end: at("2026-10-30", 21),
        available: true,
      },
      {
        date: "2026-10-31",
        start: at("2026-10-31", 9),
        end: at("2026-10-31", 19),
        available: true,
      },
    ]);

    const night = at("2026-10-29", 3);
    const x = toAxis(axis, night);
    const [wed, thu] = axis.segments;
    expect(x).toBeGreaterThan(toAxis(axis, wed.end));
    expect(x).toBeLessThan(toAxis(axis, thu.start));
    expect(toAxis(axis, thu.start) - toAxis(axis, wed.end)).toBe(axis.seam);
    expect(fromAxis(axis, x)).toBeCloseTo(night, 6);
    expect(snap5(fromAxis(axis, x))).toBe(night);
  });

  it("snap5 rounds to the nearest 5 minutes", () => {
    expect([1080, 1082, 1083, 1085, 1087, 1088].map(snap5)).toEqual([
      1080, 1080, 1085, 1085, 1085, 1090,
    ]);
    expect(snap5(1082.5)).toBe(1085);
  });

  it("B1: a placed Task outside a date's hours widens that date", () => {
    // A pin Wed 07:00–07:20, before the envelope's 09:00, and one Sat 19:00–19:30, after Availability ends.
    const axis = walkthroughAxis([
      { start: at("2026-10-28", 7), end: at("2026-10-28", 7, 20) },
      { start: at("2026-10-31", 19), end: at("2026-10-31", 19, 30) },
    ]);
    expect(axis.segments[0].start).toBe(at("2026-10-28", 7));
    expect(axis.segments.at(-1)!.end).toBe(at("2026-10-31", 19, 30));
  });
});
