import { describe, expect, it } from "vitest";
import type { Availability } from "./api.ts";
import {
  availabilityOverrideSave,
  defaultServiceTimeInput,
  endOfDay,
  kitchenSettingsSave,
  overrideHours,
  overrideInput,
  removeOverride,
  weekdayHours,
  weekHours,
  weeklyAvailabilitySave,
} from "./availability-screen.ts";
import { createIntent } from "./intent.ts";
import { minuteOfDay } from "./time-of-day.ts";

// A form's fields, as the browser's FormData would hold them (an unticked checkbox is left out).
function fields(entries: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.set(name, value);
  return form;
}

// A time of day as a minute of day, read the way the screen reads its time fields.
function at(time: string) {
  const minute = minuteOfDay(time);
  if (minute === null) throw new Error(`Not a time of day: ${time}`);
  return minute;
}

// ADR 0004's walkthrough Cook: Thursday and Friday 18:00–22:00, Saturday 09:00–19:00.
const thursday = { weekday: 4, start: at("18:00"), end: at("22:00") };

describe("endOfDay", () => {
  it("reads To 00:00 as midnight at the end of the day", () => {
    expect(endOfDay("00:00")).toBe(1440);
  });

  it("reads any other time as its minute of day, and an empty field as null", () => {
    expect(endOfDay("22:00")).toBe(at("22:00"));
    expect(endOfDay("")).toBeNull();
  });
});

describe("defaultServiceTimeInput", () => {
  it("reads the default Service time as a minute of day, or null when empty", () => {
    expect(defaultServiceTimeInput(fields({ defaultServiceTime: "19:30" }))).toBe(at("19:30"));
    expect(defaultServiceTimeInput(fields({ defaultServiceTime: "" }))).toBeNull();
  });
});

describe("weekdayHours", () => {
  it("finds the weekday's saved hours, or undefined on a day off", () => {
    const weekly: Availability["weekly"] = [{ id: "w-thu", ...thursday }];
    expect(weekdayHours(weekly, 4)).toEqual(weekly[0]);
    expect(weekdayHours(weekly, 5)).toBeUndefined();
  });
});

describe("weekHours", () => {
  it("saves each day ticked Available with its From and To, in weekday order", () => {
    const form = fields({
      "available-4": "on",
      "from-4": "18:00",
      "to-4": "22:00",
      "available-6": "on",
      "from-6": "09:00",
      "to-6": "19:00",
    });
    expect(weekHours(form)).toEqual([
      thursday,
      { weekday: 6, start: at("09:00"), end: at("19:00") },
    ]);
  });

  it("leaves out a day not ticked Available, whatever its times", () => {
    expect(weekHours(fields({ "from-4": "18:00", "to-4": "22:00" }))).toEqual([]);
  });

  it("leaves out a ticked day missing its From or its To", () => {
    expect(weekHours(fields({ "available-4": "on", "to-4": "22:00" }))).toEqual([]);
    expect(weekHours(fields({ "available-4": "on", "from-4": "18:00" }))).toEqual([]);
  });

  it("saves To 00:00 as working until midnight", () => {
    const form = fields({ "available-5": "on", "from-5": "18:00", "to-5": "00:00" });
    expect(weekHours(form)).toEqual([{ weekday: 5, start: at("18:00"), end: 1440 }]);
  });
});

describe("overrideInput", () => {
  it("saves a date's From and To as its hours", () => {
    expect(overrideInput(fields({ date: "2026-10-30", from: "19:00", to: "21:00" }))).toEqual({
      date: "2026-10-30",
      availability: { kind: "hours", start: at("19:00"), end: at("21:00") },
    });
  });

  it("saves To 00:00 as working until midnight", () => {
    expect(overrideInput(fields({ date: "2026-10-30", from: "19:00", to: "00:00" }))).toEqual({
      date: "2026-10-30",
      availability: { kind: "hours", start: at("19:00"), end: 1440 },
    });
  });

  it("saves Not available over any hours typed", () => {
    const form = fields({ date: "2026-10-30", from: "19:00", to: "21:00", off: "on" });
    expect(overrideInput(form)).toEqual({ date: "2026-10-30", availability: { kind: "off" } });
  });

  it("saves Not available with no hours typed", () => {
    expect(overrideInput(fields({ date: "2026-10-30", off: "on" }))).toEqual({
      date: "2026-10-30",
      availability: { kind: "off" },
    });
  });

  it("saves nothing without a date, even Not available", () => {
    expect(overrideInput(fields({ date: "", from: "19:00", to: "21:00" }))).toBeNull();
    expect(overrideInput(fields({ off: "on" }))).toBeNull();
  });

  it("saves nothing when the hours miss a From or a To", () => {
    expect(overrideInput(fields({ date: "2026-10-30", to: "21:00" }))).toBeNull();
    expect(overrideInput(fields({ date: "2026-10-30", from: "19:00" }))).toBeNull();
  });
});

describe("removeOverride", () => {
  it("sets the date back to the weekly hours", () => {
    expect(removeOverride("2026-10-30")).toEqual({
      date: "2026-10-30",
      availability: { kind: "weekly" },
    });
  });
});

describe("overrideHours", () => {
  it("shows an override's hours as From–To", () => {
    const hours = { start: at("19:00"), end: at("21:00") };
    expect(overrideHours({ id: "o-fri", date: "2026-10-30", hours })).toBe("19:00–21:00");
  });

  it("shows hours until midnight as ending at 00:00", () => {
    const hours = { start: at("19:00"), end: 1440 };
    expect(overrideHours({ id: "o-fri", date: "2026-10-30", hours })).toBe("19:00–00:00");
  });

  it("shows an override with no hours as not available", () => {
    expect(overrideHours({ id: "o-fri", date: "2026-10-30", hours: null })).toBe("not available");
  });
});

describe("kitchenSettingsSave", () => {
  it("sets the default Service time, and a retry of the same time keeps its id", () => {
    const intent = createIntent();
    const call = kitchenSettingsSave(1170, intent);
    expect(call).toEqual({
      id: expect.any(String),
      name: "setKitchenSettings",
      args: { defaultServiceTime: 1170 },
    });
    expect(kitchenSettingsSave(1170, intent).id).toBe(call.id);
    expect(kitchenSettingsSave(1200, intent).id).not.toBe(call.id);
  });
});

describe("weeklyAvailabilitySave", () => {
  const friday = { ...thursday, weekday: 5 };

  it("replaces the weekly hours with a new id for each day's row", () => {
    const call = weeklyAvailabilitySave([thursday, friday], createIntent());
    expect(call).toEqual({
      id: expect.any(String),
      name: "setWeeklyAvailability",
      args: {
        hours: [
          { availabilityId: expect.any(String), ...thursday },
          { availabilityId: expect.any(String), ...friday },
        ],
      },
    });
    const [thu, fri] = call.args.hours as { availabilityId: string }[];
    expect(new Set([call.id, thu?.availabilityId, fri?.availabilityId]).size).toBe(3);
  });

  it("keeps every id on a retry of the same hours, and starts fresh ones for other hours", () => {
    const intent = createIntent();
    const call = weeklyAvailabilitySave([thursday, friday], intent);
    expect(weeklyAvailabilitySave([thursday, friday], intent)).toEqual(call);
    const other = weeklyAvailabilitySave([thursday], intent);
    expect(other.id).not.toBe(call.id);
    expect(other.args.hours).not.toEqual([(call.args.hours as unknown[])[0]]);
  });

  it("saves no hours when no day is ticked", () => {
    expect(weeklyAvailabilitySave([], createIntent()).args).toEqual({ hours: [] });
  });
});

describe("availabilityOverrideSave", () => {
  const friday = removeOverride("2026-10-30");

  it("sets the date's override with a new override id", () => {
    const call = availabilityOverrideSave(friday, createIntent());
    expect(call).toEqual({
      id: expect.any(String),
      name: "setAvailabilityOverride",
      args: { overrideId: expect.any(String), ...friday },
    });
    expect(call.args.overrideId).not.toBe(call.id);
  });

  it("keeps its ids on a retry of the same override, and starts fresh ones for another", () => {
    const intent = createIntent();
    const call = availabilityOverrideSave(friday, intent);
    expect(availabilityOverrideSave(friday, intent)).toEqual(call);
    const off = { date: "2026-10-30", availability: { kind: "off" as const } };
    expect(availabilityOverrideSave(off, intent).args.overrideId).not.toBe(call.args.overrideId);
  });
});
