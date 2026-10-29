import { describe, expect, it } from "vitest";
import {
  FRIDAY,
  pastryBehindPlan,
  roastTheBones,
  SATURDAY,
  SERVICE_ID,
  THURSDAY,
  walkthroughPlan,
} from "../test/today-plan.ts";
import { createIntent } from "./intent.ts";
import {
  boxChecked,
  dayFromLink,
  linkWithDay,
  shownDay,
  tickKey,
  tickSave,
  todayIn,
  wasDue,
} from "./today-checklist.ts";

// 23:30 UTC on Thursday: already Friday in Paris (UTC+1), still Thursday in New York.
const lateThursdayUtc = new Date("2026-10-29T23:30:00Z");

describe("todayIn", () => {
  it("is the date in the kitchen's zone, not UTC's", () => {
    expect(todayIn("Europe/Paris", lateThursdayUtc)).toBe("2026-10-30");
    expect(todayIn("America/New_York", lateThursdayUtc)).toBe("2026-10-29");
  });
});

describe("the link's day", () => {
  it("is the day param, or null when the link has none", () => {
    expect(dayFromLink("?view=today&service=s-saturday&day=2026-10-30")).toBe("2026-10-30");
    expect(dayFromLink("?view=today&service=s-saturday")).toBeNull();
  });

  it("sets the day, keeping the link's other params", () => {
    expect(linkWithDay("?view=today&service=s-saturday", FRIDAY)).toBe(
      "?view=today&service=s-saturday&day=2026-10-30",
    );
    expect(linkWithDay("?view=today&day=2026-10-29&service=s-saturday", SATURDAY)).toBe(
      "?view=today&day=2026-10-31&service=s-saturday",
    );
  });
});

describe("shownDay", () => {
  const dateOf = (...args: Parameters<typeof shownDay>) => shownDay(...args)?.date;
  const saturdayNoon = new Date("2026-10-31T11:00:00Z");

  it("is undefined until the Plan has loaded", () => {
    expect(shownDay(undefined, FRIDAY, saturdayNoon)).toBeUndefined();
  });

  it("is the chosen day, over a behind Task and today", () => {
    expect(dateOf(pastryBehindPlan(), THURSDAY, saturdayNoon)).toBe(THURSDAY);
  });

  it("is the earliest day with a behind Task when none is chosen, over today", () => {
    expect(dateOf(pastryBehindPlan(), null, saturdayNoon)).toBe(FRIDAY);
  });

  it("skips a chosen day the Plan has no Tasks on", () => {
    expect(dateOf(pastryBehindPlan(), "2026-10-28", saturdayNoon)).toBe(FRIDAY);
  });

  it("is today in the Plan's zone when nothing is behind", () => {
    expect(dateOf(walkthroughPlan(), null, saturdayNoon)).toBe(SATURDAY);
    expect(dateOf(walkthroughPlan(), null, lateThursdayUtc)).toBe(FRIDAY);
    expect(dateOf(walkthroughPlan({ timeZone: "America/New_York" }), null, lateThursdayUtc)).toBe(
      THURSDAY,
    );
  });

  it("is the first day when today has no Tasks", () => {
    expect(dateOf(walkthroughPlan(), null, new Date("2026-11-02T12:00:00Z"))).toBe(THURSDAY);
  });

  it("is undefined when the Plan has no days", () => {
    expect(shownDay(walkthroughPlan({ days: [] }), FRIDAY, saturdayNoon)).toBeUndefined();
  });
});

describe("wasDue", () => {
  const behind = { dueAt: "19:30", dueDate: FRIDAY, holdsUp: [] };

  it("is the time alone on the day it was due", () => {
    expect(wasDue(behind, FRIDAY)).toBe("19:30");
  });

  it("names the day it was due when seen on another day", () => {
    expect(wasDue(behind, SATURDAY)).toBe("Fri 19:30");
  });
});

describe("boxChecked", () => {
  const key = tickKey(roastTheBones, "st-roast");

  it("is the Step's own done when no tick is on its way", () => {
    expect(boxChecked(null, key, false)).toBe(false);
    expect(boxChecked(null, key, true)).toBe(true);
  });

  it("is the tick on its way for its own box", () => {
    expect(boxChecked({ key, done: true }, key, false)).toBe(true);
    expect(boxChecked({ key, done: false }, key, true)).toBe(false);
  });

  it("ignores a tick on its way for another box", () => {
    const other = tickKey(roastTheBones, "st-other");
    expect(boxChecked({ key: other, done: true }, key, false)).toBe(false);
  });
});

describe("tickSave", () => {
  const anId: unknown = expect.any(String);

  it("ticks a Step with tickStep, for its Task's owner and this Service", () => {
    const call = tickSave(SERVICE_ID, roastTheBones, "st-roast", true, createIntent());
    expect(call).toEqual({
      id: anId,
      name: "tickStep",
      args: {
        eventId: anId,
        serviceId: SERVICE_ID,
        owner: { kind: "batch", batchId: "b-stock" },
        stepId: "st-roast",
      },
    });
    expect(call.args.eventId).not.toBe(call.id);
  });

  it("unticks a Step with untickStep", () => {
    expect(tickSave(SERVICE_ID, roastTheBones, "st-roast", false, createIntent()).name).toBe(
      "untickStep",
    );
  });

  it("keeps its ids on a retry of the same tick, and starts fresh ones for an untick", () => {
    const intent = createIntent();
    const tick = tickSave(SERVICE_ID, roastTheBones, "st-roast", true, intent);
    expect(tickSave(SERVICE_ID, roastTheBones, "st-roast", true, intent)).toEqual(tick);
    const untick = tickSave(SERVICE_ID, roastTheBones, "st-roast", false, intent);
    expect(untick.id).not.toBe(tick.id);
    expect(untick.args.eventId).not.toBe(tick.args.eventId);
  });
});
