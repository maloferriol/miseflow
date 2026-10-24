import { describe, expect, it } from "vitest";
import type { TaskInfo } from "./model.ts";
import { describeConflict, describeUnplaced } from "./reasons.ts";
import { zonedMinute } from "./time.ts";

const paris = "Europe/Paris";
const at = (date: string, hours: number, minutes = 0) => zonedMinute(date, hours * 60 + minutes, paris);
const task = (activeMinutes: number, passiveMinutes = 0): TaskInfo => ({
  key: "dish:d:s",
  owner: { kind: "dish", dishId: "d" },
  dishId: "d",
  batchId: null,
  stepIds: ["s"],
  activeMinutes,
  passiveMinutes,
  trailingPassiveMinutes: 0,
  approximate: false,
});
const labelOf = () => "Sear the duck";

describe("describeUnplaced", () => {
  it("says no Cook has the Task's free minutes in the window it searched", () => {
    const reason = { kind: "NoAvailability" as const, minutesNeeded: 20, searched: { start: at("2026-10-30", 0), end: at("2026-10-30", 19, 50) } };
    expect(describeUnplaced(reason, task(20), paris, labelOf)).toBe("No Cook has 20 free minutes between Fri 00:00 and Fri 19:50");
  });

  it("adds the passive time that follows", () => {
    const reason = { kind: "NoAvailability" as const, minutesNeeded: 220, searched: { start: at("2026-10-30", 0), end: at("2026-10-30", 19, 50) } };
    expect(describeUnplaced(reason, task(20, 200), paris, labelOf)).toBe(
      "No Cook has 20 free minutes between Fri 00:00 and Fri 19:50, with 3 h 20 min of passive time after",
    );
  });

  it("says how much time a too-tight window has", () => {
    const reason = { kind: "WindowTooTight" as const, minutesNeeded: 130, window: { start: at("2026-10-30", 0), end: at("2026-10-30", 1, 30) } };
    expect(describeUnplaced(reason, task(130), paris, labelOf)).toBe("It needs 2 h 10 min, but only 1 h 30 min lie between Fri 00:00 and Fri 01:30");
  });

  it("names the pinned Task in the way", () => {
    const reason = { kind: "BlockedByPin" as const, pin: "dish:d:p", searched: { start: at("2026-10-31", 17), end: at("2026-10-31", 19, 30) } };
    expect(describeUnplaced(reason, task(20), paris, labelOf)).toBe("The pinned Task Sear the duck leaves no room between Sat 17:00 and Sat 19:30");
  });

  it("adds the date when the window spans 7 days or more", () => {
    const reason = { kind: "NoAvailability" as const, minutesNeeded: 20, searched: { start: at("2026-10-23", 0), end: at("2026-10-30", 19, 50) } };
    expect(describeUnplaced(reason, task(20), paris, labelOf)).toBe("No Cook has 20 free minutes between Fri 23 Oct 00:00 and Fri 30 Oct 19:50");
  });
});

describe("describeConflict", () => {
  const label = (key: string) => (key === "batch:b:s3" ? "Strain the stock (Chicken stock ×1.5)" : "Blend and season (Velouté)");

  it("says when a Batch keeps until and when its latest use is", () => {
    const conflict = {
      key: "batch:b:s3",
      kind: "ShelfLifeExceeded" as const,
      readyAt: at("2026-10-29", 21, 30),
      keepsUntil: at("2026-10-30", 21, 30),
      use: "dish:d:v3",
      useAt: at("2026-10-31", 18, 50),
    };
    expect(describeConflict(conflict, label, paris)).toBe(
      "Strain the stock (Chicken stock ×1.5) keeps until Fri 21:30, but Blend and season (Velouté) uses it at Sat 18:50",
    );
  });

  it("measures a result nothing else uses against Service", () => {
    const conflict = {
      key: "batch:b:s3",
      kind: "ShelfLifeExceeded" as const,
      readyAt: at("2026-10-29", 21, 30),
      keepsUntil: at("2026-10-30", 21, 30),
      use: null,
      useAt: at("2026-10-31", 19, 30),
    };
    expect(describeConflict(conflict, label, paris)).toBe("Strain the stock (Chicken stock ×1.5) keeps until Fri 21:30, but Service is at Sat 19:30");
  });

  it("says when a Batch is ready and when its earliest use starts", () => {
    const conflict = {
      key: "batch:b:s3",
      kind: "EarliestUseTooLate" as const,
      readyAt: at("2026-10-29", 22, 10),
      use: "dish:d:v3",
      useAt: at("2026-10-29", 21, 50),
    };
    expect(describeConflict(conflict, label, paris)).toBe(
      "Strain the stock (Chicken stock ×1.5) is ready at Thu 22:10, but Blend and season (Velouté) starts at Thu 21:50",
    );
  });

  it("says a Task starts before the late Task it waits for is ready", () => {
    const conflict = {
      key: "dish:d:v2",
      kind: "Outrun" as const,
      by: "dish:d:v1",
      readyAt: at("2026-10-31", 18, 10),
      start: at("2026-10-31", 17, 55),
    };
    const names = (key: string) => (key === "dish:d:v1" ? "Sweat the shallots (Velouté)" : "Add the stock and simmer (Velouté)");
    expect(describeConflict(conflict, names, paris)).toBe(
      "Add the stock and simmer (Velouté) starts at Sat 17:55, but Sweat the shallots (Velouté) ran late and is only ready at Sat 18:10",
    );
  });
});
