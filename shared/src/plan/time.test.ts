import { describe, expect, it } from "vitest";
import { addDays, localParts, weekdayOf, zonedMinute } from "./time.ts";

const utc = (iso: string) => Date.parse(iso) / 60_000;
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("zonedMinute", () => {
  it("reads a wall-clock time that doesn't exist (spring gap) as the later instant", () => {
    expect(zonedMinute("2026-03-29", h(2, 30), "Europe/Paris")).toBe(utc("2026-03-29T01:30Z"));
  });

  it("reads a wall-clock time that happens twice (autumn) as the earlier instant", () => {
    expect(zonedMinute("2026-10-25", h(2, 30), "Europe/Paris")).toBe(utc("2026-10-25T00:30Z"));
  });

  it("reads minute 1440 as the next day's 00:00", () => {
    expect(zonedMinute("2026-10-31", 1440, "Europe/Paris")).toBe(zonedMinute("2026-11-01", 0, "Europe/Paris"));
  });

  it("throws RangeError for an unknown time zone", () => {
    expect(() => zonedMinute("2026-10-31", 0, "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("localParts", () => {
  it("round-trips zonedMinute, with 0 = Sunday", () => {
    const at = zonedMinute("2026-10-31", h(19, 30), "Europe/Paris");
    expect(localParts(at, "Europe/Paris")).toEqual({ date: "2026-10-31", minuteOfDay: h(19, 30), weekday: 6 });
    expect(weekdayOf("2026-10-25")).toBe(0);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});
