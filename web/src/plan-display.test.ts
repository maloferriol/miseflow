import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayHeading, ownerOf, shortDay, taskTimes } from "./plan-display.ts";

// A zone behind UTC, where midnight UTC is still the evening before, so formatting in the
// browser's zone would show the day before.
beforeEach(() => {
  vi.stubEnv("TZ", "Pacific/Honolulu");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dayHeading", () => {
  it("names the kitchen-zone date's weekday, day and month", () => {
    expect(dayHeading("2026-10-29")).toBe("Thursday 29 October");
  });

  it("keeps the date's own day when the browser's zone is behind UTC", () => {
    expect(new Date("2026-10-29T00:00:00Z").getDate()).toBe(28);
    expect(dayHeading("2026-10-29")).toBe("Thursday 29 October");
  });
});

describe("shortDay", () => {
  it("is the date's short weekday, in UTC", () => {
    expect(shortDay("2026-10-30")).toBe("Fri");
  });
});

describe("ownerOf", () => {
  it("is the Dish's name for a Dish's Task", () => {
    expect(ownerOf({ dish: { name: "Velouté" }, batch: null })).toBe("Velouté");
  });

  it("is the Batch's label over a Dish's name", () => {
    const label = "Chicken stock ×1.5 · for: Velouté, Beurre blanc";
    expect(ownerOf({ dish: { name: "Velouté" }, batch: { label } })).toBe(label);
  });
});

describe("taskTimes", () => {
  it("is start–end for a Task that ends on its own day", () => {
    expect(taskTimes({ start: "18:20", end: "18:40", endDate: "2026-10-29" }, "2026-10-29")).toBe(
      "18:20–18:40",
    );
  });

  it("names the end's day for a Task that ends on another day", () => {
    expect(taskTimes({ start: "21:50", end: "22:00", endDate: "2026-10-30" }, "2026-10-29")).toBe(
      "21:50–22:00 (Fri)",
    );
  });
});
