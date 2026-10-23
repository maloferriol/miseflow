import { describe, expect, it } from "vitest";
import type { TaskInfo } from "./model.ts";
import { describeUnplaced } from "./reasons.ts";
import { zonedMinute } from "./time.ts";

const paris = "Europe/Paris";
const at = (date: string, hours: number, minutes = 0) => zonedMinute(date, hours * 60 + minutes, paris);
const task = (activeMinutes: number, passiveMinutes = 0): TaskInfo => ({
  key: "dish:d:s",
  owner: { kind: "dish", dishId: "d" },
  dishId: "d",
  stepIds: ["s"],
  activeMinutes,
  passiveMinutes,
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
