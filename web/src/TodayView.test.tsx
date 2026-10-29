import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import {
  FRIDAY,
  makeThePastry,
  pastryBehindPlan,
  roastTheBones,
  SATURDAY,
  SERVICE_ID,
  scoreTheDuck,
  simmerTheStock,
  sweatTheShallots,
  THURSDAY,
  walkthroughPlan,
} from "../test/today-plan.ts";
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

// "18:20–18:40 · Chicken stock ×1.5 · for: Velouté, Beurre blanc · Roast the bones", as a Task's line starts.
const lineOf = (task: PlanTask, date: string) =>
  `${taskTimes(task, date)} · ${ownerOf(task)} · ${task.steps.map((s) => s.text).join(", ")}`;

const panel = () => screen.getByRole("tabpanel");
const items = () => within(panel()).getAllByRole("listitem");

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
    renderView(<TodayView {...props(walkthroughPlan(), THURSDAY)} />);
    expect(within(panel()).getByRole("list", { name: dayHeading(THURSDAY) })).toBeTruthy();
    const lines = [roastTheBones, simmerTheStock].map((t) => lineOf(t, THURSDAY));
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
    const behind = shownDay(plan, null, saturdayNoon)!.tasks[0].behind!;
    expect(pastry.textContent).toContain(`· behind · was due ${wasDue(behind, FRIDAY)}`);
    expect(within(pastry).getByText("Holds up: Tarte tatin · Bake the tart")).toBeTruthy();
    expect(pastry.className).toBe("behind");
  });

  it("names the day a behind Task was due when it was due on another day", () => {
    const behind = { dueAt: "19:30", dueDate: FRIDAY, holdsUp: [] };
    const duck = { ...scoreTheDuck, behind };
    const plan = walkthroughPlan();
    plan.days[2] = { date: SATURDAY, tasks: [sweatTheShallots, duck] };
    renderView(<TodayView {...props(plan, SATURDAY)} />);
    const [shallots, late] = items();
    expect(late.textContent).toContain(`· behind · was due ${wasDue(behind, SATURDAY)}`);
    expect(late.textContent).not.toContain("Holds up");
    expect(shallots.textContent).not.toContain("behind");
    expect(shallots.className).toBe("");
  });

  it("shows each conflict's sentence under its Task", () => {
    const sentence = "Made too early: the duck keeps 2 hours";
    const plan = walkthroughPlan({
      conflicts: [
        {
          key: scoreTheDuck.key,
          kind: "ShelfLifeExceeded",
          dish: scoreTheDuck.dish,
          batch: null,
          steps: [],
          use: { key: null, label: "Service" },
          sentence,
        },
      ],
    });
    renderView(<TodayView {...props(plan, SATURDAY)} />);
    const [shallots, duck] = items();
    expect(within(duck).getByText(sentence)).toBeTruthy();
    expect(within(shallots).queryByText(sentence)).toBeNull();
  });

  it("shows a tick box per Step, ticked when the Step is done", () => {
    renderView(<TodayView {...props(walkthroughPlan(), SATURDAY)} />);
    const sweat = screen.getByRole<HTMLInputElement>("checkbox", { name: "Sweat the shallots" });
    const score = screen.getByRole<HTMLInputElement>("checkbox", { name: "Score the duck" });
    expect([sweat.checked, score.checked]).toEqual([true, false]);
    expect([sweat.disabled, score.disabled]).toEqual([false, false]);
  });

  it("ticks and unticks a Step for its Task", () => {
    const p = props(walkthroughPlan(), SATURDAY);
    renderView(<TodayView {...p} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Score the duck" }));
    expect(p.onTick).toHaveBeenCalledWith(scoreTheDuck, "st-score", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Sweat the shallots" }));
    expect(p.onTick).toHaveBeenLastCalledWith(sweatTheShallots, "st-sweat", false);
  });

  it("shows a tick on its way at once and disables every box until it settles", () => {
    const ticking = { key: tickKey(simmerTheStock, "st-simmer"), done: true };
    renderView(<TodayView {...props(walkthroughPlan(), THURSDAY, { ticking })} />);
    const boxes = screen.getAllByRole<HTMLInputElement>("checkbox");
    expect(boxes.map((b) => [b.labels?.[0]?.textContent?.trim(), b.checked, b.disabled])).toEqual([
      ["Roast the bones", false, true],
      ["Cover with water", false, true],
      ["Simmer the stock", true, true],
    ]);
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
    const sentence = "No Cook has 20 free minutes between Fri 00:00 and Fri 19:50";
    const plan = walkthroughPlan({
      unplaced: [
        {
          key: makeThePastry.key,
          dish: makeThePastry.dish,
          batch: null,
          steps: [{ id: "st-pastry", text: "Make the pastry" }],
          kind: "NoAvailability",
          sentence,
          blockingPin: null,
          dishes: [{ id: "d-tatin", name: "Tarte tatin" }],
          moreTime: true,
        },
      ],
    });
    renderView(<TodayView {...props(plan, null)} />);
    const list = screen.getByRole("list", { name: "Unplaced Tasks" });
    expect(within(list).getByRole("listitem").textContent).toBe(
      `Tarte tatin · Make the pastry: ${sentence}`,
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
