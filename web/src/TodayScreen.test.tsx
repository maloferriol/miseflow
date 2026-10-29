import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import {
  FRIDAY,
  pastryBehindPlan,
  roastTheBones,
  SATURDAY,
  SERVICE_ID,
  sweatTheShallots,
  THURSDAY,
  walkthroughPlan,
} from "../test/today-plan.ts";
import { fetchPlan, mutate } from "./api.ts";
import { dayHeading, ownerOf, taskTimes } from "./plan-display.ts";
import { tickKey, wasDue } from "./today-checklist.ts";
import { TodayScreen, useTodayChecklist } from "./TodayScreen.tsx";

// The network boundary only: the hook's query and mutation run through a real QueryClient.
vi.mock("./api.ts", () => ({ fetchPlan: vi.fn(), mutate: vi.fn() }));

// Any made-up id: the intent makes ids with crypto.randomUUID.
const anId: unknown = expect.any(String);

// Friday 19:00 in Paris (UTC+1): the pastry's day, before it's due at 19:30.
const fridayEvening = new Date("2026-10-30T18:00:00Z");

beforeEach(() => {
  // Real time still moves the faked clock, so React Query and waitFor run as usual.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(fridayEvening);
  window.history.replaceState(null, "", `/?view=today&service=${SERVICE_ID}`);
  vi.mocked(fetchPlan).mockReset().mockResolvedValue(walkthroughPlan());
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A save that stays pending until the test settles it.
function settleLater() {
  let settle: { resolve: () => void; reject: (error: Error) => void } = {
    resolve: () => {},
    reject: () => {},
  };
  vi.mocked(mutate).mockReturnValueOnce(
    new Promise<void>((resolve, reject) => (settle = { resolve, reject })),
  );
  return {
    succeed: () =>
      act(async () => {
        settle.resolve();
        await Promise.resolve();
      }),
    fail: (error: Error) =>
      act(async () => {
        settle.reject(error);
        await Promise.resolve();
      }),
  };
}

const renderChecklist = () => renderQueryHook(() => useTodayChecklist(SERVICE_ID));

describe("Today checklist hook", () => {
  it("returns this Service's Plan, on today's tab in the kitchen's zone", async () => {
    const { result } = renderChecklist();
    await waitFor(() => expect(result.current.plan.data).toEqual(walkthroughPlan()));
    expect(fetchPlan).toHaveBeenCalledWith(SERVICE_ID);
    expect(result.current.day?.date).toBe(FRIDAY);
    expect(result.current).toMatchObject({ ticking: null, tickError: null });
  });

  it("takes today in the Plan's zone, not the browser's or UTC's", async () => {
    // 00:30 on Saturday in Paris, still Friday 19:30 in New York.
    vi.setSystemTime(new Date("2026-10-30T23:30:00Z"));
    const { result } = renderChecklist();
    await waitFor(() => expect(result.current.day?.date).toBe(SATURDAY));

    vi.mocked(fetchPlan).mockResolvedValue(walkthroughPlan({ timeZone: "America/New_York" }));
    const other = renderChecklist();
    await waitFor(() => expect(other.result.current.day?.date).toBe(FRIDAY));
  });

  it("opens the day named in the link", async () => {
    window.history.replaceState(null, "", `/?view=today&service=${SERVICE_ID}&day=${THURSDAY}`);
    const { result } = renderChecklist();
    await waitFor(() => expect(result.current.day?.date).toBe(THURSDAY));
  });

  it("opens the chosen day and puts it in the link, keeping the link's other params", async () => {
    const { result } = renderChecklist();
    await waitFor(() => expect(result.current.day?.date).toBe(FRIDAY));
    act(() => result.current.onChoose(SATURDAY));
    expect(result.current.day?.date).toBe(SATURDAY);
    expect(window.location.search).toBe(`?view=today&service=${SERVICE_ID}&day=${SATURDAY}`);
  });

  it("ticks a Step with tickStep for its Task, shows it at once, then refetches the Plan", async () => {
    const { result } = renderChecklist();
    await waitFor(() => expect(result.current.plan.status).toBe("success"));
    const save = settleLater();

    act(() => result.current.onTick(roastTheBones, "st-roast", true));
    expect(result.current.ticking).toEqual({ key: tickKey(roastTheBones, "st-roast"), done: true });
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(anId, "tickStep", {
        eventId: anId,
        serviceId: SERVICE_ID,
        owner: roastTheBones.owner,
        stepId: "st-roast",
      }),
    );

    await save.succeed();
    await waitFor(() => expect(result.current.ticking).toBeNull());
    expect(fetchPlan).toHaveBeenCalledTimes(2);
  });

  it("unticks a Step with untickStep", async () => {
    const { result } = renderChecklist();
    await waitFor(() => expect(result.current.plan.status).toBe("success"));
    act(() => result.current.onTick(sweatTheShallots, "st-sweat", false));
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));
    expect(mutate).toHaveBeenCalledWith(anId, "untickStep", {
      eventId: anId,
      serviceId: SERVICE_ID,
      owner: sweatTheShallots.owner,
      stepId: "st-sweat",
    });
  });

  it("returns a failed tick's error, drops the tick and keeps the Plan as read", async () => {
    const { result } = renderChecklist();
    await waitFor(() => expect(result.current.plan.status).toBe("success"));
    const save = settleLater();
    act(() => result.current.onTick(roastTheBones, "st-roast", true));
    await save.fail(new Error("Could not save (500)"));

    await waitFor(() =>
      expect(result.current.tickError).toEqual(new Error("Could not save (500)")),
    );
    expect(result.current.ticking).toBeNull();
    expect(fetchPlan).toHaveBeenCalledOnce();
  });

  it("replays a failed tick's ids on its retry, and starts fresh ones once it saves", async () => {
    const { result } = renderChecklist();
    await waitFor(() => expect(result.current.plan.status).toBe("success"));
    const ids = (call: number) => {
      const [id, , args] = vi.mocked(mutate).mock.calls[call];
      return [id, args.eventId];
    };

    vi.mocked(mutate).mockRejectedValueOnce(new Error("Could not save (500)"));
    act(() => result.current.onTick(roastTheBones, "st-roast", true));
    await waitFor(() => expect(result.current.tickError).not.toBeNull());
    act(() => result.current.onTick(roastTheBones, "st-roast", true));
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));
    expect(ids(1)).toEqual(ids(0));

    act(() => result.current.onTick(roastTheBones, "st-roast", true));
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(3));
    expect(ids(2)[0]).not.toBe(ids(1)[0]);
    expect(ids(2)[1]).not.toBe(ids(1)[1]);
  });
});

describe("Today checklist", () => {
  const tab = (date: string) => screen.getByRole("tab", { name: dayHeading(date) });
  const panel = () => screen.getByRole("tabpanel");

  it("shows Loading… until the Plan arrives, then today's Tasks", async () => {
    renderWired(<TodayScreen serviceId={SERVICE_ID} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await waitFor(() => expect(tab(FRIDAY).getAttribute("aria-selected")).toBe("true"));
    expect(within(panel()).getByRole("list", { name: dayHeading(FRIDAY) })).toBeTruthy();
  });

  it("shows a failed load as an alert", async () => {
    vi.mocked(fetchPlan).mockRejectedValue(new Error("Could not load the Plan (500)"));
    renderWired(<TodayScreen serviceId={SERVICE_ID} />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Could not load the Plan (500)"),
    );
  });

  it("switches to the day the cook clicks and keeps it in the link", async () => {
    renderWired(<TodayScreen serviceId={SERVICE_ID} />);
    await waitFor(() => expect(tab(FRIDAY).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(tab(THURSDAY));
    expect(tab(THURSDAY).getAttribute("aria-selected")).toBe("true");
    expect(within(panel()).getByRole("list", { name: dayHeading(THURSDAY) })).toBeTruthy();
    expect(window.location.search).toBe(`?view=today&service=${SERVICE_ID}&day=${THURSDAY}`);
  });

  it("records a tick on a Step, then shows the re-read Plan", async () => {
    window.history.replaceState(null, "", `/?view=today&service=${SERVICE_ID}&day=${THURSDAY}`);
    renderWired(<TodayScreen serviceId={SERVICE_ID} />);
    const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Roast the bones" });
    const save = settleLater();
    const ticked = walkthroughPlan();
    ticked.days[0] = {
      ...ticked.days[0],
      tasks: ticked.days[0].tasks.map((t) =>
        t === roastTheBones
          ? { ...t, steps: [{ ...t.steps[0], done: true, doneAt: "19:00" }], done: true }
          : t,
      ),
    };
    vi.mocked(fetchPlan).mockResolvedValue(ticked);

    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(screen.getAllByRole<HTMLInputElement>("checkbox").every((b) => b.disabled)).toBe(true);
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(anId, "tickStep", {
        eventId: anId,
        serviceId: SERVICE_ID,
        owner: roastTheBones.owner,
        stepId: "st-roast",
      }),
    );

    await save.succeed();
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(box.checked).toBe(true);
  });

  it("shows a failed tick as an alert and the box as the Plan has it", async () => {
    window.history.replaceState(null, "", `/?view=today&service=${SERVICE_ID}&day=${THURSDAY}`);
    renderWired(<TodayScreen serviceId={SERVICE_ID} />);
    const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Roast the bones" });
    vi.mocked(mutate).mockRejectedValueOnce(new Error("Could not save (500)"));
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not save (500)"));
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
  });

  it("shows a Task as behind once the next minute's read measures it", async () => {
    renderWired(<TodayScreen serviceId={SERVICE_ID} />);
    await waitFor(() => expect(tab(FRIDAY).getAttribute("aria-selected")).toBe("true"));
    expect(within(panel()).getByRole("listitem").textContent).not.toContain("behind");

    // 19:31 in Paris: past the pastry's 19:30, as the server now reads the Plan.
    const behind = pastryBehindPlan();
    vi.mocked(fetchPlan).mockResolvedValue(behind);
    await act(() => vi.advanceTimersByTimeAsync(59_000));
    expect(fetchPlan).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));

    const pastry = behind.days[1].tasks[0];
    await waitFor(() =>
      expect(within(panel()).getByRole("listitem").textContent).toContain(
        `${taskTimes(pastry, FRIDAY)} · ${ownerOf(pastry)} · Make the pastry · behind · was due ${wasDue(pastry.behind!, FRIDAY)}`,
      ),
    );
  });

  it("prints the Plan", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderWired(<TodayScreen serviceId={SERVICE_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Print the Plan" }));
    expect(print).toHaveBeenCalledOnce();
  });
});
