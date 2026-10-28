import { describe, expect, it } from "vitest";
import { parseGuests, serviceInput } from "./menu-screen.ts";

describe("parseGuests", () => {
  it("reads a whole number of guests", () => {
    expect(parseGuests("6")).toBe(6);
  });

  it.each(["", "0", "-2", "2.5", "six"])("reads no guest count from %j", (text) => {
    expect(parseGuests(text)).toBeNull();
  });
});

describe("serviceInput", () => {
  it("reads a date and a time of day as a minute of day", () => {
    expect(serviceInput("2026-10-31", "19:30")).toEqual({ date: "2026-10-31", time: 1170 });
  });

  it("reads an empty time as the kitchen's default", () => {
    expect(serviceInput("2026-10-31", "")).toEqual({ date: "2026-10-31", time: null });
  });

  it("saves nothing without a date", () => {
    expect(serviceInput("", "19:30")).toBeNull();
  });

  it.each(["24:00", "19:60", "7pm"])("saves nothing for the time %j", (time) => {
    expect(serviceInput("2026-10-31", time)).toBeNull();
  });
});
