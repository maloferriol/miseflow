import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import type { Availability } from "./api.ts";
import { AvailabilityView, type AvailabilityViewProps } from "./AvailabilityView.tsx";
import { minuteOfDay } from "./time-of-day.ts";

// A time of day as a minute of day, read the way the screen reads its time fields.
function at(time: string) {
  const minute = minuteOfDay(time);
  if (minute === null) throw new Error(`Not a time of day: ${time}`);
  return minute;
}

// ADR 0004's walkthrough Cook: Thu and Fri 18:00–22:00, Sat 09:00–19:00, and Fri 30 Oct
// 19:00–21:00. Sun 1 Nov is a day off, for an override with no hours.
const walkthrough: Availability = {
  timeZone: "Europe/Paris",
  defaultServiceTime: at("19:00"),
  defaultServiceTimeIsBuiltIn: true,
  weekly: [
    { id: "w-thu", weekday: 4, start: at("18:00"), end: at("22:00") },
    { id: "w-fri", weekday: 5, start: at("18:00"), end: at("22:00") },
    { id: "w-sat", weekday: 6, start: at("09:00"), end: at("19:00") },
  ],
  overrides: [
    { id: "o-fri", date: "2026-10-30", hours: { start: at("19:00"), end: at("21:00") } },
    { id: "o-sun", date: "2026-11-01", hours: null },
  ],
};

const props = (overrides: Partial<AvailabilityViewProps> = {}): AvailabilityViewProps => ({
  availability: { status: "success", data: walkthrough },
  defaultPending: false,
  weekPending: false,
  overridePending: false,
  error: null,
  onSaveDefault: vi.fn(),
  onSaveWeek: vi.fn(),
  onSaveOverride: vi.fn(),
  onRemoveOverride: vi.fn(),
  ...overrides,
});

const button = (name: string) => screen.getByRole("button", { name });
const day = (name: string) => within(screen.getByRole("group", { name }));
const field = (label: HTMLElement) => label as HTMLInputElement;
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
// The date override form's From and To come after the seven weekdays' own.
const overrideField = (label: string) => screen.getAllByLabelText(label).at(-1) as HTMLElement;

describe("Availability view", () => {
  it("shows Loading… while the Availability loads", () => {
    renderView(<AvailabilityView {...props({ availability: { status: "pending" } })} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Availability" })).toBeNull();
  });

  it("shows a failed load as an alert with its message", () => {
    const error = new Error("Could not load the Availability (500)");
    renderView(<AvailabilityView {...props({ availability: { status: "error", error } })} />);
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Availability (500)");
    expect(screen.queryByRole("button", { name: "Save week" })).toBeNull();
  });

  it("says the times are in the kitchen's time zone, and shows the default Service time", () => {
    renderView(<AvailabilityView {...props()} />);
    expect(screen.getByText("Times are in the kitchen's time zone, Europe/Paris.")).toBeTruthy();
    expect(field(screen.getByLabelText("Default Service time")).value).toBe("19:00");
  });

  it("shows each weekday's saved hours, and a day off unticked with no times", () => {
    renderView(<AvailabilityView {...props()} />);
    const thursday = day("Thursday");
    expect(field(thursday.getByLabelText("Available")).checked).toBe(true);
    expect(field(thursday.getByLabelText("From")).value).toBe("18:00");
    expect(field(thursday.getByLabelText("To")).value).toBe("22:00");
    expect(field(day("Saturday").getByLabelText("From")).value).toBe("09:00");
    const sunday = day("Sunday");
    expect(field(sunday.getByLabelText("Available")).checked).toBe(false);
    expect(field(sunday.getByLabelText("From")).value).toBe("");
    expect(field(sunday.getByLabelText("To")).value).toBe("");
  });

  it("lists each date override with its hours, or as not available", () => {
    renderView(<AvailabilityView {...props()} />);
    const items = within(screen.getByRole("list", { name: "Date overrides" })).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "2026-10-30: 19:00–21:00 Remove",
      "2026-11-01: not available Remove",
    ]);
  });

  it("removes a date's override with its Remove button", () => {
    const onRemoveOverride = vi.fn();
    renderView(<AvailabilityView {...props({ onRemoveOverride })} />);
    const sunday = screen.getByText(/2026-11-01/);
    fireEvent.click(within(sunday).getByRole("button", { name: "Remove" }));
    expect(onRemoveOverride).toHaveBeenCalledExactlyOnceWith("2026-11-01");
  });

  it("saves the default Service time typed", () => {
    const onSaveDefault = vi.fn();
    renderView(<AvailabilityView {...props({ onSaveDefault })} />);
    type(screen.getByLabelText("Default Service time"), "19:30");
    fireEvent.submit(button("Save default"));
    expect(onSaveDefault).toHaveBeenCalledExactlyOnceWith(at("19:30"));
  });

  it("saves no default Service time when the field is empty", () => {
    const onSaveDefault = vi.fn();
    renderView(<AvailabilityView {...props({ onSaveDefault })} />);
    type(screen.getByLabelText("Default Service time"), "");
    fireEvent.submit(button("Save default"));
    expect(onSaveDefault).not.toHaveBeenCalled();
  });

  it("saves the week as shown when nothing is changed", () => {
    const onSaveWeek = vi.fn();
    renderView(<AvailabilityView {...props({ onSaveWeek })} />);
    fireEvent.submit(button("Save week"));
    expect(onSaveWeek).toHaveBeenCalledExactlyOnceWith([
      { weekday: 4, start: at("18:00"), end: at("22:00") },
      { weekday: 5, start: at("18:00"), end: at("22:00") },
      { weekday: 6, start: at("09:00"), end: at("19:00") },
    ]);
  });

  it("saves the week as changed: a day unticked, a day added, a day until midnight", () => {
    const onSaveWeek = vi.fn();
    renderView(<AvailabilityView {...props({ onSaveWeek })} />);
    fireEvent.click(day("Thursday").getByLabelText("Available"));
    fireEvent.click(day("Monday").getByLabelText("Available"));
    type(day("Monday").getByLabelText("From"), "10:00");
    type(day("Monday").getByLabelText("To"), "14:00");
    type(day("Friday").getByLabelText("To"), "00:00");
    fireEvent.submit(button("Save week"));
    expect(onSaveWeek).toHaveBeenCalledExactlyOnceWith([
      { weekday: 1, start: at("10:00"), end: at("14:00") },
      { weekday: 5, start: at("18:00"), end: 1440 },
      { weekday: 6, start: at("09:00"), end: at("19:00") },
    ]);
  });

  it("leaves out of the week a day ticked Available without both times", () => {
    const onSaveWeek = vi.fn();
    renderView(<AvailabilityView {...props({ onSaveWeek })} />);
    fireEvent.click(day("Monday").getByLabelText("Available"));
    type(day("Monday").getByLabelText("From"), "10:00");
    type(day("Saturday").getByLabelText("From"), "");
    fireEvent.submit(button("Save week"));
    expect(onSaveWeek).toHaveBeenCalledExactlyOnceWith([
      { weekday: 4, start: at("18:00"), end: at("22:00") },
      { weekday: 5, start: at("18:00"), end: at("22:00") },
    ]);
  });

  it("keeps the week as edited while the saved hours stay the same", () => {
    const { rerender } = renderView(<AvailabilityView {...props()} />);
    type(day("Thursday").getByLabelText("To"), "23:00");
    rerender(<AvailabilityView {...props({ weekPending: true })} />);
    expect(field(day("Thursday").getByLabelText("To")).value).toBe("23:00");
  });

  it("shows the newly saved hours once the week changes", () => {
    const { rerender } = renderView(<AvailabilityView {...props()} />);
    type(day("Thursday").getByLabelText("To"), "23:00");
    const saved = {
      ...walkthrough,
      weekly: [{ id: "w-thu", weekday: 4, start: at("17:00"), end: at("21:00") }],
    };
    rerender(<AvailabilityView {...props({ availability: { status: "success", data: saved } })} />);
    expect(field(day("Thursday").getByLabelText("From")).value).toBe("17:00");
    expect(field(day("Thursday").getByLabelText("To")).value).toBe("21:00");
    expect(field(day("Friday").getByLabelText("Available")).checked).toBe(false);
  });

  it("saves a date override's hours", () => {
    const onSaveOverride = vi.fn();
    renderView(<AvailabilityView {...props({ onSaveOverride })} />);
    type(screen.getByLabelText("Date"), "2026-10-29");
    type(overrideField("From"), "19:00");
    type(overrideField("To"), "00:00");
    fireEvent.submit(button("Save override"));
    expect(onSaveOverride).toHaveBeenCalledExactlyOnceWith({
      date: "2026-10-29",
      availability: { kind: "hours", start: at("19:00"), end: 1440 },
    });
  });

  it("saves a date as not available, whatever hours are typed", () => {
    const onSaveOverride = vi.fn();
    renderView(<AvailabilityView {...props({ onSaveOverride })} />);
    type(screen.getByLabelText("Date"), "2026-10-29");
    type(overrideField("From"), "19:00");
    fireEvent.click(screen.getByLabelText("Not available"));
    fireEvent.submit(button("Save override"));
    expect(onSaveOverride).toHaveBeenCalledExactlyOnceWith({
      date: "2026-10-29",
      availability: { kind: "off" },
    });
  });

  it("saves no override for hours missing a To, or without a date", () => {
    const onSaveOverride = vi.fn();
    renderView(<AvailabilityView {...props({ onSaveOverride })} />);
    type(screen.getByLabelText("Date"), "2026-10-29");
    type(overrideField("From"), "19:00");
    fireEvent.submit(button("Save override"));
    type(screen.getByLabelText("Date"), "");
    fireEvent.click(screen.getByLabelText("Not available"));
    fireEvent.submit(button("Save override"));
    expect(onSaveOverride).not.toHaveBeenCalled();
  });

  it("disables each save button while its own save is pending", () => {
    const { rerender } = renderView(<AvailabilityView {...props({ defaultPending: true })} />);
    const disabled = () =>
      ["Save default", "Save week", "Save override"].filter(
        (name) => (button(name) as HTMLButtonElement).disabled,
      );
    expect(disabled()).toEqual(["Save default"]);
    rerender(<AvailabilityView {...props({ weekPending: true })} />);
    expect(disabled()).toEqual(["Save week"]);
    rerender(<AvailabilityView {...props({ overridePending: true })} />);
    expect(disabled()).toEqual(["Save override"]);
  });

  it("shows a failed save as an alert with its message", () => {
    const error = new Error("setWeeklyAvailability failed (500)");
    renderView(<AvailabilityView {...props({ error })} />);
    expect(screen.getByRole("alert").textContent).toBe("setWeeklyAvailability failed (500)");
  });

  it("shows no alert while no save has failed", () => {
    renderView(<AvailabilityView {...props()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
