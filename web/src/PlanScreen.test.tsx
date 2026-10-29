import { applyPlacements, withPin } from "@miseflow/shared/src/plan/pin.ts";
import { schedule } from "@miseflow/shared/src/scheduler/schedule.ts";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saturdayMenu, saturdayPlan } from "../test/plan-fixture.ts";
import { renderQueryHook, renderWired } from "../test/render-view.tsx";
import { fetchMenu, fetchPlan, mutate, type Plan } from "./api.ts";
import { ganttCourses } from "./plan-screen.ts";
import { PlanScreen, usePlanScreen } from "./PlanScreen.tsx";

// The network boundary only: the hook's queries and mutations run through a real QueryClient.
vi.mock("./api.ts", () => ({
  fetchMenu: vi.fn(),
  fetchPlan: vi.fn(),
  mutate: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchPlan).mockReset().mockResolvedValue(saturdayPlan);
  vi.mocked(fetchMenu).mockReset().mockResolvedValue(saturdayMenu);
  vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

// Each mutation sent, as [name, args].
const sent = () => vi.mocked(mutate).mock.calls.map(([, name, args]) => [name, args]);

// A mutation that stays pending until the test settles it.
function settleLater() {
  let resolve = () => {};
  let reject: (error: Error) => void = () => {};
  vi.mocked(mutate).mockReturnValueOnce(
    new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  );
  return {
    resolve: () => act(() => resolve()),
    reject: (error: Error) => act(() => reject(error)),
  };
}

const duck = saturdayPlan.days[0].tasks[0];
// Friday 17:30, half an hour after the duck's pinned start.
const later = duck.startMinute + 30;

async function renderLoadedHook() {
  const rendered = renderQueryHook(() => usePlanScreen("s-saturday"));
  await waitFor(() => expect(rendered.result.current.courses).toBeDefined());
  return rendered;
}

describe("Plan screen hook", () => {
  it("returns the Service's Plan, then the Courses of its Menu for the Gantt chart", async () => {
    const { result } = renderQueryHook(() => usePlanScreen("s-saturday"));
    expect(result.current.plan.status).toBe("pending");
    expect(result.current.courses).toBeUndefined();
    await waitFor(() => expect(result.current.courses).toEqual(ganttCourses(saturdayMenu)));
    expect(result.current.plan.data).toEqual(saturdayPlan);
    expect(fetchPlan).toHaveBeenCalledWith("s-saturday");
    expect(fetchMenu).toHaveBeenCalledWith("m-dinner");
    expect(result.current).toMatchObject({ fixPending: false, fixError: null });
  });

  it("doesn't fetch a Menu while the Plan is loading", () => {
    vi.mocked(fetchPlan).mockReturnValue(new Promise(() => {}));
    renderQueryHook(() => usePlanScreen("s-saturday"));
    expect(fetchMenu).not.toHaveBeenCalled();
  });

  it("sends a fix, then reads the Plan and the Menu again", async () => {
    const { result } = await renderLoadedHook();
    act(() => result.current.onFix({ name: "removeDish", args: { dishId: "d-tarte" } }));
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual([["removeDish", { dishId: "d-tarte" }]]);
  });

  it("returns a fix as pending, then its error, and still reads the Plan and the Menu again", async () => {
    const save = settleLater();
    const { result } = await renderLoadedHook();
    act(() =>
      result.current.onFix({ name: "replanFromScratch", args: { serviceId: "s-saturday" } }),
    );
    await waitFor(() => expect(result.current.fixPending).toBe(true));
    save.reject(new Error("replanFromScratch failed (500)"));
    await waitFor(() =>
      expect(result.current.fixError).toEqual(new Error("replanFromScratch failed (500)")),
    );
    expect(result.current.fixPending).toBe(false);
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(2));
  });

  it("pins a dragged Task and shows the browser's re-plan until the stored Plan is read again", async () => {
    const save = settleLater();
    const { result } = await renderLoadedHook();
    act(() => result.current.onPin(duck, later));
    await waitFor(() =>
      expect(sent()).toEqual([
        [
          "pinTask",
          {
            serviceId: "s-saturday",
            owner: { kind: "dish", dishId: "d-duck" },
            firstStepId: "s-sear",
            start: later,
          },
        ],
      ]),
    );
    const replanned = applyPlacements(
      saturdayPlan,
      schedule(withPin(saturdayPlan.model, duck.key, later)),
    );
    await waitFor(() => expect(result.current.plan.data).toEqual(replanned));
    expect(fetchPlan).toHaveBeenCalledOnce();

    save.resolve();
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.plan.data).toEqual(saturdayPlan));
  });

  it("reads the Plan again only when the last of two pins settles", async () => {
    const first = settleLater();
    const second = settleLater();
    const { result } = await renderLoadedHook();
    act(() => result.current.onPin(duck, later));
    act(() => result.current.onPin(duck, later + 10));
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    // The second waits for the first: it isn't sent while the first is pending.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(mutate).toHaveBeenCalledOnce();

    first.resolve();
    // Pins of one Service run one after another, so the second is sent once the first settles.
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(fetchPlan).toHaveBeenCalledOnce();

    second.resolve();
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));
  });

  it("doesn't read the Plan again on focus while a pin is pending", async () => {
    const save = settleLater();
    const { result } = await renderLoadedHook();
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));

    act(() => result.current.onPin(duck, later));
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    expect(fetchPlan).toHaveBeenCalledTimes(2);

    save.resolve();
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(3));
  });

  it("doesn't read the Plan again on reconnect while a pin is pending", async () => {
    const save = settleLater();
    const { result } = await renderLoadedHook();
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));

    act(() => result.current.onPin(duck, later));
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    expect(fetchPlan).toHaveBeenCalledTimes(2);

    save.resolve();
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(3));
  });
});

describe("Plan screen", () => {
  const renderScreen = () => renderWired(<PlanScreen serviceId="s-saturday" />);
  const removeTarte = () => screen.getByRole("button", { name: "Remove Tarte tatin" });

  it("shows Loading…, then the Plan with its Gantt chart", async () => {
    renderScreen();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Gantt chart" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Plan for/ }).textContent).toBe(
      "Plan for Saturday 31 October at 19:30",
    );
  });

  it("shows why the Plan didn't load", async () => {
    vi.mocked(fetchPlan).mockRejectedValue(new Error("Could not load the Plan (404)"));
    renderScreen();
    expect((await screen.findByRole("alert")).textContent).toBe("Could not load the Plan (404)");
  });

  it("removes a Dish when the cook confirms, then reads the Plan again", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const calm: Plan = { ...saturdayPlan, unplaced: [] };
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Tarte tatin" }));
    vi.mocked(fetchPlan).mockResolvedValue(calm);
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Remove Tarte tatin from the Menu?");
    expect(await screen.findByText("Every Task is planned")).toBeTruthy();
    expect(sent()).toEqual([["removeDish", { dishId: "d-tarte" }]]);
  });

  it("keeps the Plan and sends nothing when the cook cancels removing a Dish", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Tarte tatin" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(removeTarte()).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
    expect(fetchPlan).toHaveBeenCalledOnce();
  });

  it("gives the Cook more time with a new override id", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Give the Cook more time" }));
    await waitFor(() => expect(fetchPlan).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual([
      [
        "giveCookMoreTime",
        {
          serviceId: "s-saturday",
          owner: { kind: "dish", dishId: "d-tarte" },
          firstStepId: "s-pastry",
          overrideId: expect.any(String) as unknown,
        },
      ],
    ]);
  });

  it("re-plans from scratch, disabling the fixes while it saves, and shows its error", async () => {
    const save = settleLater();
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Re-plan from scratch" }));
    await waitFor(() =>
      expect(sent()).toEqual([["replanFromScratch", { serviceId: "s-saturday" }]]),
    );
    await waitFor(() => expect((removeTarte() as HTMLButtonElement).disabled).toBe(true));

    save.reject(new Error("replanFromScratch failed (500)"));
    expect((await screen.findByRole("alert")).textContent).toBe("replanFromScratch failed (500)");
    expect((removeTarte() as HTMLButtonElement).disabled).toBe(false);
  });

  it("prints the Plan", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Print the Plan" }));
    expect(print).toHaveBeenCalledOnce();
  });
});
