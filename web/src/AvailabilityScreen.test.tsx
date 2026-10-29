import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import { type Availability, fetchAvailability, mutate } from "./api.ts";
import { AvailabilityScreen, useAvailabilityScreen } from "./AvailabilityScreen.tsx";
import { removeOverride } from "./availability-screen.ts";
import { minuteOfDay } from "./time-of-day.ts";

// The network boundary only: the hook's query and mutations run through a real QueryClient.
vi.mock("./api.ts", () => ({ fetchAvailability: vi.fn(), mutate: vi.fn() }));

// Any made-up id: the hook makes ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

// A time of day as a minute of day, read the way the screen reads its time fields.
function at(time: string) {
  const minute = minuteOfDay(time);
  if (minute === null) throw new Error(`Not a time of day: ${time}`);
  return minute;
}

// ADR 0004's walkthrough Cook: Thu and Fri 18:00–22:00, Sat 09:00–19:00, and Fri 30 Oct 19:00–21:00.
const walkthrough: Availability = {
  timeZone: "Europe/Paris",
  defaultServiceTime: at("19:00"),
  defaultServiceTimeIsBuiltIn: true,
  weekly: [
    { id: "w-thu", weekday: 4, start: at("18:00"), end: at("22:00") },
    { id: "w-fri", weekday: 5, start: at("18:00"), end: at("22:00") },
    { id: "w-sat", weekday: 6, start: at("09:00"), end: at("19:00") },
  ],
  overrides: [{ id: "o-fri", date: "2026-10-30", hours: { start: at("19:00"), end: at("21:00") } }],
};

beforeEach(() => {
  vi.mocked(fetchAvailability).mockReset().mockResolvedValue(walkthrough);
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});

// The args of the last mutation sent with this name, and every mutation id sent.
const sent = (name: string) =>
  vi
    .mocked(mutate)
    .mock.calls.filter((call) => call[1] === name)
    .at(-1)?.[2];
const ids = () => vi.mocked(mutate).mock.calls.map((call) => call[0]);

// A save that stays pending until the test fails it.
function failLater() {
  let fail: (error: Error) => void = () => {};
  vi.mocked(mutate).mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
  return (error: Error) => act(() => fail(error));
}

// The hook, loaded, with a Plan in the cache that a save should invalidate.
async function renderLoaded() {
  const rendered = renderQueryHook(() => useAvailabilityScreen());
  rendered.client.setQueryData(["plan", "s-saturday"], { tasks: [] });
  await waitFor(() => expect(rendered.result.current.availability.status).toBe("success"));
  return rendered;
}

// After a save: the Availability was fetched again and the cached Plan is stale.
async function expectReplanned(client: ReturnType<typeof renderQueryHook>["client"]) {
  await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(2));
  expect(client.getQueryState(["plan", "s-saturday"])?.isInvalidated).toBe(true);
}

describe("Availability hook", () => {
  it("returns the Availability it fetched, with no save pending or failed", async () => {
    const { result } = await renderLoaded();
    expect(result.current.availability.data).toEqual(walkthrough);
    expect(result.current).toMatchObject({
      defaultPending: false,
      weekPending: false,
      overridePending: false,
      error: null,
    });
  });

  it("sets the default Service time, then refetches the Availability and invalidates the Plan", async () => {
    const { result, client } = await renderLoaded();
    act(() => result.current.onSaveDefault(at("19:30")));
    await expectReplanned(client);
    expect(mutate).toHaveBeenCalledExactlyOnceWith(anId, "setKitchenSettings", {
      defaultServiceTime: at("19:30"),
    });
  });

  it("replaces the weekly hours, a new id per row, then refetches and invalidates the Plan", async () => {
    const { result, client } = await renderLoaded();
    const thursday = { weekday: 4, start: at("18:00"), end: at("22:00") };
    const saturday = { weekday: 6, start: at("09:00"), end: 1440 };
    act(() => result.current.onSaveWeek([thursday, saturday]));
    await expectReplanned(client);
    expect(mutate).toHaveBeenCalledExactlyOnceWith(anId, "setWeeklyAvailability", {
      hours: [
        { availabilityId: anId, ...thursday },
        { availabilityId: anId, ...saturday },
      ],
    });
  });

  it("sets a date's override, then refetches and invalidates the Plan", async () => {
    const { result, client } = await renderLoaded();
    const off = { date: "2026-10-29", availability: { kind: "off" as const } };
    act(() => result.current.onSaveOverride(off));
    await expectReplanned(client);
    expect(mutate).toHaveBeenCalledExactlyOnceWith(anId, "setAvailabilityOverride", {
      overrideId: anId,
      ...off,
    });
  });

  it("removes a date's override by setting it back to the weekly hours", async () => {
    const { result, client } = await renderLoaded();
    act(() => result.current.onRemoveOverride("2026-10-30"));
    await expectReplanned(client);
    expect(mutate).toHaveBeenCalledExactlyOnceWith(anId, "setAvailabilityOverride", {
      overrideId: anId,
      ...removeOverride("2026-10-30"),
    });
  });

  const saves = [
    {
      name: "default",
      pending: "defaultPending",
      save: (s: ReturnType<typeof useAvailabilityScreen>) => s.onSaveDefault(at("19:30")),
    },
    {
      name: "week",
      pending: "weekPending",
      save: (s: ReturnType<typeof useAvailabilityScreen>) => s.onSaveWeek([]),
    },
    {
      name: "override",
      pending: "overridePending",
      save: (s: ReturnType<typeof useAvailabilityScreen>) => s.onRemoveOverride("2026-10-30"),
    },
  ] as const;

  it.each(saves)(
    "returns the $name save as pending, then its error, without refetching",
    async ({ pending, save }) => {
      const { result, client } = await renderLoaded();
      const fail = failLater();
      act(() => save(result.current));
      await waitFor(() => expect(result.current[pending]).toBe(true));
      fail(new Error("Save failed (500)"));
      await waitFor(() => expect(result.current.error).toEqual(new Error("Save failed (500)")));
      expect(result.current[pending]).toBe(false);
      expect(fetchAvailability).toHaveBeenCalledOnce();
      expect(client.getQueryState(["plan", "s-saturday"])?.isInvalidated).toBe(false);
    },
  );

  it("replays a failed save's ids on a retry, and starts fresh ids once a save succeeds", async () => {
    const { result } = await renderLoaded();
    const fail = failLater();
    const thursday = { weekday: 4, start: at("18:00"), end: at("22:00") };
    act(() => result.current.onSaveWeek([thursday]));
    fail(new Error("Network error"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    const failed = sent("setWeeklyAvailability");

    act(() => result.current.onSaveWeek([thursday]));
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(2));
    expect(sent("setWeeklyAvailability")).toEqual(failed);
    expect(ids()[1]).toBe(ids()[0]);

    act(() => result.current.onSaveWeek([thursday]));
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(3));
    expect(ids()[2]).not.toBe(ids()[0]);
    expect(sent("setWeeklyAvailability")).not.toEqual(failed);
  });
});

const button = (name: string) => screen.getByRole("button", { name });
const day = (name: string) => within(screen.getByRole("group", { name }));
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
// The date override form's From and To come after the seven weekdays' own.
const overrideField = (label: string) => screen.getAllByLabelText(label).at(-1) as HTMLElement;

describe("Availability screen", () => {
  it("shows Loading… until the Availability loads, then its time zone", async () => {
    renderWired(<AvailabilityScreen />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      await screen.findByText("Times are in the kitchen's time zone, Europe/Paris."),
    ).toBeTruthy();
  });

  it("shows a failed load as an alert", async () => {
    vi.mocked(fetchAvailability).mockRejectedValue(
      new Error("Could not load the Availability (500)"),
    );
    renderWired(<AvailabilityScreen />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not load the Availability (500)",
    );
  });

  it("saves the default Service time typed", async () => {
    renderWired(<AvailabilityScreen />);
    type(await screen.findByLabelText("Default Service time"), "19:30");
    fireEvent.submit(button("Save default"));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(anId, "setKitchenSettings", {
        defaultServiceTime: at("19:30"),
      }),
    );
  });

  it("saves the week as edited, and still shows it once the Availability refetches", async () => {
    renderWired(<AvailabilityScreen />);
    await screen.findByRole("group", { name: "Thursday" });
    const saved = {
      ...walkthrough,
      weekly: [{ id: "w-mon", weekday: 1, start: at("10:00"), end: at("14:00") }],
    };
    vi.mocked(fetchAvailability).mockResolvedValue(saved);
    for (const name of ["Thursday", "Friday", "Saturday", "Monday"])
      fireEvent.click(day(name).getByLabelText("Available"));
    type(day("Monday").getByLabelText("From"), "10:00");
    type(day("Monday").getByLabelText("To"), "14:00");
    fireEvent.submit(button("Save week"));

    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(2));
    expect(sent("setWeeklyAvailability")).toEqual({
      hours: [{ availabilityId: anId, weekday: 1, start: at("10:00"), end: at("14:00") }],
    });
    expect(day("Monday").getByLabelText<HTMLInputElement>("Available").checked).toBe(true);
    expect(day("Monday").getByLabelText<HTMLInputElement>("To").value).toBe("14:00");
    expect(day("Thursday").getByLabelText<HTMLInputElement>("Available").checked).toBe(false);
  });

  it("disables Save week while it saves, and shows a failed save as an alert", async () => {
    const fail = failLater();
    renderWired(<AvailabilityScreen />);
    await screen.findByRole("group", { name: "Thursday" });
    fireEvent.submit(button("Save week"));
    await waitFor(() => expect((button("Save week") as HTMLButtonElement).disabled).toBe(true));
    fail(new Error("setWeeklyAvailability failed (500)"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "setWeeklyAvailability failed (500)",
    );
    expect((button("Save week") as HTMLButtonElement).disabled).toBe(false);
  });

  it("saves a date override, then lists it as the server saved it", async () => {
    renderWired(<AvailabilityScreen />);
    await screen.findByLabelText("Date");
    const saved = {
      ...walkthrough,
      overrides: [...walkthrough.overrides, { id: "o-thu", date: "2026-10-29", hours: null }],
    };
    vi.mocked(fetchAvailability).mockResolvedValue(saved);
    type(screen.getByLabelText("Date"), "2026-10-29");
    type(overrideField("From"), "19:00");
    fireEvent.click(screen.getByLabelText("Not available"));
    fireEvent.submit(button("Save override"));

    expect(await screen.findByText(/2026-10-29: not available/)).toBeTruthy();
    expect(sent("setAvailabilityOverride")).toEqual({
      overrideId: anId,
      date: "2026-10-29",
      availability: { kind: "off" },
    });
  });

  it("removes a date's override, then lists the overrides the server kept", async () => {
    renderWired(<AvailabilityScreen />);
    const friday = await screen.findByText(/2026-10-30: 19:00–21:00/);
    vi.mocked(fetchAvailability).mockResolvedValue({ ...walkthrough, overrides: [] });
    fireEvent.click(within(friday).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText(/2026-10-30/)).toBeNull());
    expect(sent("setAvailabilityOverride")).toEqual({
      overrideId: anId,
      ...removeOverride("2026-10-30"),
    });
  });
});
