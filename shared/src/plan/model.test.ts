import { describe, expect, it } from "vitest";
import { freeIntervals } from "./model.ts";

const utc = (iso: string) => Date.parse(iso) / 60_000;
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("freeIntervals", () => {
  it("turns Thu and Fri 18:00–22:00, Sat 09:00–19:00 and an override Fri 19:00–21:00 into Paris intervals across the end of summer time", () => {
    const weekly = [
      { weekday: 4, start: h(18), end: h(22) },
      { weekday: 5, start: h(18), end: h(22) },
      { weekday: 6, start: h(9), end: h(19) },
    ];
    const overrides = [{ date: "2026-10-30", hours: { start: h(19), end: h(21) } }];
    expect(freeIntervals(weekly, overrides, "2026-10-22", "2026-10-31", "Europe/Paris")).toEqual([
      { start: utc("2026-10-22T16:00Z"), end: utc("2026-10-22T20:00Z") }, // Thu, UTC+2
      { start: utc("2026-10-23T16:00Z"), end: utc("2026-10-23T20:00Z") }, // Fri
      { start: utc("2026-10-24T07:00Z"), end: utc("2026-10-24T17:00Z") }, // Sat
      // Sun 25 Oct: summer time ends
      { start: utc("2026-10-29T17:00Z"), end: utc("2026-10-29T21:00Z") }, // Thu, UTC+1
      { start: utc("2026-10-30T18:00Z"), end: utc("2026-10-30T20:00Z") }, // Fri: the override
      { start: utc("2026-10-31T08:00Z"), end: utc("2026-10-31T18:00Z") }, // Sat
    ]);
  });

  it("gives no interval on a date whose override is null (not available)", () => {
    const weekly = [{ weekday: 5, start: h(18), end: h(22) }];
    expect(freeIntervals(weekly, [{ date: "2026-10-30", hours: null }], "2026-10-30", "2026-10-30", "Europe/Paris")).toEqual([]);
  });

  it("ends an Availability that runs to midnight at the next day's 00:00", () => {
    const weekly = [{ weekday: 6, start: h(18), end: 1440 }];
    expect(freeIntervals(weekly, [], "2026-10-31", "2026-10-31", "Europe/Paris")).toEqual([
      { start: utc("2026-10-31T17:00Z"), end: utc("2026-10-31T23:00Z") },
    ]);
  });
});
