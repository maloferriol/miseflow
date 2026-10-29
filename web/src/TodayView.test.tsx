import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import {
  dayOf,
  FRIDAY,
  keys,
  pastryBehindPlan,
  SATURDAY,
  SERVICE_ID,
  taskIn,
  THURSDAY,
  troubledPlan,
  TUESDAY,
  walkthroughPlan,
} from "../test/walkthrough-plan.ts";
import type { Plan, PlanTask } from "./api.ts";
import { dayHeading, ownerOf, taskTimes } from "./plan-display.ts";
import { shownDay, tickKey, wasDue } from "./today-checklist.ts";
import { TodayView, type TodayViewProps } from "./TodayView.tsx";

const saturdayNoon = new Date("2026-10-31T11:00:00Z");

/** The view over a loaded Plan, on the day `shownDay` picks for `chosen`. */
function props(
  plan: Plan,
  chosen: string | null,
  change: Partial<TodayViewProps> = {},
): TodayViewProps {
  return {
    serviceId: SERVICE_ID,
    plan: { status: "success", data: plan },
    day: shownDay(plan, chosen, saturdayNoon),
    ticking: null,
    tickError: null,
    onChoose: vi.fn(),
    onTick: vi.fn(),
    onPrint: vi.fn(),
    ...change,
  };
}

// "14:10–17:20 · Chicken stock ×1.5 · for: Velouté, Beurre blanc · Roast the bones, …", as a Task's line starts.
const lineOf = (task: PlanTask, date: string) =>
  `${taskTimes(task, date)} · ${ownerOf(task)} · ${task.steps.map((s) => s.text).join(", ")}`;

const panel = () => screen.getByRole("tabpanel");
const items = () => within(panel()).getAllByRole("listitem");
const tasksOn = (plan: Plan, date: string) => plan.days.find((d) => d.date === date)!.tasks;
const box = (name: string) => screen.getByRole<HTMLInputElement>("checkbox", { name });

describe("Today checklist view", () => {
  it("shows Loading… while the Plan loads", () => {
    renderView(<TodayView {...props(walkthroughPlan(), null)} plan={{ status: "pending" }} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows a failed load as an alert with its message", () => {
    const error = new Error("Could not load the Plan (500)");
    renderView(<TodayView {...props(walkthroughPlan(), null)} plan={{ status: "error", error }} />);
    expect(screen.getByRole("alert").textContent).toBe("Could not load the Plan (500)");
  });

  it("links back to this Service's Plan", () => {
    renderView(<TodayView {...props(walkthroughPlan(), null)} />);
    expect(screen.getByRole("link", { name: "Back to the Plan" }).getAttribute("href")).toBe(
      `?view=plan&service=${SERVICE_ID}`,
    );
  });

  it("shows a tab per prep day, the shown day's selected", () => {
    renderView(<TodayView {...props(walkthroughPlan(), FRIDAY)} />);
    const tablist = screen.getByRole("tablist", { name: "Prep days" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([THURSDAY, FRIDAY, SATURDAY].map(dayHeading));
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(panel().getAttribute("aria-labelledby")).toBe(tabs[1].id);
  });

  it("chooses the day of the tab the cook clicks", () => {
    const p = props(walkthroughPlan(), FRIDAY);
    renderView(<TodayView {...p} />);
    fireEvent.click(screen.getByRole("tab", { name: dayHeading(SATURDAY) }));
    expect(p.onChoose).toHaveBeenCalledWith(SATURDAY);
  });

  it("lists the shown day's Tasks in Plan time order, with their times, owner and Steps", () => {
    const plan = walkthroughPlan();
    renderView(<TodayView {...props(plan, SATURDAY)} />);
    expect(within(panel()).getByRole("list", { name: dayHeading(SATURDAY) })).toBeTruthy();
    const lines = tasksOn(plan, SATURDAY).map((t) => lineOf(t, SATURDAY));
    expect(lines).toHaveLength(5);
    expect(items().map((li, i) => li.textContent?.slice(0, lines[i].length))).toEqual(lines);
  });

  it("shows no Task panel when the Plan has no days", () => {
    const plan = walkthroughPlan({ days: [] });
    renderView(<TodayView {...props(plan, null)} />);
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("shows a behind Task as behind, when it was due and what it holds up", () => {
    const plan = pastryBehindPlan();
    renderView(<TodayView {...props(plan, null)} />);
    const [pastry] = items();
    const { behind } = taskIn(plan, keys.pastry);
    expect(pastry.textContent).toContain(`· behind · was due ${wasDue(behind!, FRIDAY)}`);
    expect(
      within(pastry).getByText("Holds up: Tarte tatin · Caramelise the apples, Bake the tart"),
    ).toBeTruthy();
    expect(pastry.className).toBe("behind");
  });

  it("names the day a behind Task was due when it was due on another day", () => {
    // Friday's late pastry, as if it were the duck's on Saturday's tab.
    const { behind } = taskIn(pastryBehindPlan(), keys.pastry);
    const plan = walkthroughPlan();
    const saturday = plan.days.find((d) => d.date === SATURDAY)!;
    saturday.tasks = saturday.tasks.map((t) =>
      t.key === keys.duck ? { ...t, behind: { ...behind!, holdsUp: [] } } : t,
    );
    renderView(<TodayView {...props(plan, SATURDAY)} />);
    const position = (key: string) => saturday.tasks.findIndex((t) => t.key === key);
    const late = items()[position(keys.duck)];
    const veloute = items()[position(keys.veloute)];
    expect(late.textContent).toContain(`· behind · was due ${wasDue(behind!, SATURDAY)}`);
    expect(late.textContent).not.toContain("Holds up");
    expect(veloute.textContent).not.toContain("behind");
    expect(veloute.className).toBe("");
  });

  it("shows each conflict's sentence under its Task", () => {
    const [conflict] = troubledPlan.conflicts;
    const { unmount } = renderView(
      <TodayView {...props(troubledPlan, dayOf(troubledPlan, conflict.key))} />,
    );
    const [stock] = items();
    expect(stock.textContent).toContain(lineOf(taskIn(troubledPlan, conflict.key), TUESDAY));
    expect(within(stock).getByText(conflict.sentence)).toBeTruthy();
    unmount();

    renderView(<TodayView {...props(troubledPlan, SATURDAY)} />);
    expect(within(panel()).queryByText(conflict.sentence)).toBeNull();
  });

  it("shows a tick box per Step, ticked when the Step is done", () => {
    const { unmount } = renderView(<TodayView {...props(walkthroughPlan(), THURSDAY)} />);
    expect([box("Dry-brine the duck").checked, box("Dry-brine the duck").disabled]).toEqual([
      true,
      false,
    ]);
    unmount();

    renderView(<TodayView {...props(walkthroughPlan(), FRIDAY)} />);
    expect([box("Make the pastry").checked, box("Make the pastry").disabled]).toEqual([
      false,
      false,
    ]);
  });

  it("ticks a Step for its Task", () => {
    const plan = walkthroughPlan();
    const p = props(plan, SATURDAY);
    renderView(<TodayView {...p} />);
    fireEvent.click(box("Score and season"));
    expect(p.onTick).toHaveBeenCalledWith(taskIn(plan, keys.duck), "D2", true);
  });

  it("unticks a done Step for its Task", () => {
    const plan = walkthroughPlan();
    const p = props(plan, THURSDAY);
    renderView(<TodayView {...p} />);
    fireEvent.click(box("Dry-brine the duck"));
    expect(p.onTick).toHaveBeenCalledWith(taskIn(plan, keys.brine), "D1", false);
  });

  it("shows a tick on its way at once and disables every box until it settles", () => {
    const plan = walkthroughPlan();
    const stock = taskIn(plan, keys.stock);
    const ticking = { key: tickKey(stock, "S2"), done: true };
    renderView(<TodayView {...props(plan, SATURDAY, { ticking })} />);
    const boxes = screen.getAllByRole<HTMLInputElement>("checkbox");
    const expected = tasksOn(plan, SATURDAY).flatMap((t) =>
      t.steps.map((s) => [s.text, t === stock && s.id === "S2", true]),
    );
    expect(expected.filter(([, checked]) => checked)).toHaveLength(1);
    expect(boxes.map((b) => [b.labels?.[0]?.textContent?.trim(), b.checked, b.disabled])).toEqual(
      expected,
    );
  });

  it("shows a failed tick as an alert with its message", () => {
    const tickError = new Error("Could not save (500)");
    renderView(<TodayView {...props(walkthroughPlan(), THURSDAY, { tickError })} />);
    expect(screen.getByRole("alert").textContent).toBe("Could not save (500)");
  });

  it("says every Task is planned when none is Unplaced", () => {
    renderView(<TodayView {...props(walkthroughPlan(), null)} />);
    expect(screen.getByText("Every Task is planned")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Unplaced Tasks" })).toBeNull();
  });

  it("lists each Unplaced Task with its owner, Steps and reason", () => {
    const [pastry] = troubledPlan.unplaced;
    renderView(<TodayView {...props(troubledPlan, null)} />);
    const list = screen.getByRole("list", { name: "Unplaced Tasks" });
    expect(within(list).getByRole("listitem").textContent).toBe(
      `Pastry ×1 · for: Tarte tatin · Make the pastry: ${pastry.sentence}`,
    );
    expect(screen.queryByText("Every Task is planned")).toBeNull();
  });

  it("prints the Plan when the cook asks", () => {
    const p = props(walkthroughPlan(), null);
    renderView(<TodayView {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Print the Plan" }));
    expect(p.onPrint).toHaveBeenCalledOnce();
  });

  it("holds the printed Plan", () => {
    renderView(<TodayView {...props(walkthroughPlan(), null)} />);
    expect(screen.getByRole("region", { name: "Printed Plan" })).toBeTruthy();
  });
});
