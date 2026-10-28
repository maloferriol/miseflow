import { describe, expect, it } from "vitest";
import { createIntent } from "./intent.ts";
import {
  dishScale,
  dishScaleSave,
  openingScaleKind,
  parseGuests,
  serviceInput,
  serviceSave,
} from "./menu-screen.ts";

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

describe("openingScaleKind", () => {
  it("opens a Dish with a set factor on Factor, and any other on Guests", () => {
    expect(openingScaleKind({ source: "set" })).toBe("factor");
    expect(openingScaleKind({ source: "guests" })).toBe("guests");
    expect(openingScaleKind({ source: "assumed" })).toBe("guests");
  });
});

describe("dishScale", () => {
  it("scales by the guest count, ignoring the number field", () => {
    expect(dishScale("guests", "")).toEqual({ kind: "guests" });
  });

  it("scales to a portion count or by a factor", () => {
    expect(dishScale("portions", "8")).toEqual({ kind: "portions", portions: 8 });
    expect(dishScale("factor", "1.5")).toEqual({ kind: "factor", factor: 1.5 });
  });
});

describe("dishScaleSave", () => {
  it("sets the Dish's scale", () => {
    const save = dishScaleSave("d-velouté", { kind: "portions", portions: 8 }, createIntent());
    expect({ name: save.name, args: save.args }).toEqual({
      name: "setDishScale",
      args: { dishId: "d-velouté", scale: { kind: "portions", portions: 8 } },
    });
  });

  it("keeps its mutation id when the same scale is retried, and starts a new one for another", () => {
    const intent = createIntent();
    const first = dishScaleSave("d-velouté", { kind: "factor", factor: 1.5 }, intent);
    expect(dishScaleSave("d-velouté", { kind: "factor", factor: 1.5 }, intent).id).toBe(first.id);
    expect(dishScaleSave("d-velouté", { kind: "guests" }, intent).id).not.toBe(first.id);
  });
});

describe("serviceSave", () => {
  const saturday = { date: "2026-10-31", time: 1170 };

  it("creates the Menu's Service when it has none, with a Service id kept across retries", () => {
    const intent = createIntent();
    const save = serviceSave("m-dinner", null, saturday, intent);
    expect(save.name).toBe("createService");
    expect(save.args).toEqual({
      serviceId: expect.any(String),
      menuId: "m-dinner",
      date: "2026-10-31",
      time: 1170,
    });
    expect(save.args.serviceId).not.toBe(save.id);
    expect(serviceSave("m-dinner", null, saturday, intent)).toEqual(save);
  });

  it("sets the time of the Service the Menu has", () => {
    const save = serviceSave("m-dinner", { id: "s-saturday" }, saturday, createIntent());
    expect({ name: save.name, args: save.args }).toEqual({
      name: "setServiceTime",
      args: { serviceId: "s-saturday", date: "2026-10-31", time: 1170 },
    });
  });

  it("starts new ids for another date or time", () => {
    const intent = createIntent();
    const first = serviceSave("m-dinner", null, saturday, intent);
    const later = serviceSave("m-dinner", null, { date: "2026-10-31", time: null }, intent);
    expect(later.id).not.toBe(first.id);
    expect(later.args.serviceId).not.toBe(first.args.serviceId);
  });
});
