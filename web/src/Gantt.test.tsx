import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import {
  at,
  beurreLabel,
  keys,
  model,
  pastryLabel,
  planOf,
  SATURDAY,
  saturdayMenu,
  stockLabel,
  taskIn,
} from "../test/walkthrough-plan.ts";
import { Gantt } from "./Gantt.tsx";
import { ganttCourses } from "./plan-screen.ts";

// A browser zone an hour off the kitchen's, so a time drawn in the browser's zone reads wrong.
vi.stubEnv("TZ", "UTC");

// ADR 0004's walkthrough Plan (`web/test/walkthrough-plan.ts`): the Cook free Thursday 18:00–22:00,
// Friday 19:00–21:00 and Saturday 09:00–19:00 in Paris, the Service on Saturday at 19:30.
const plan = planOf();
const courses = ganttCourses(saturdayMenu);
const noPin = () => {};

const lanes = () => screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
const lane = (name: string) => screen.getByRole("group", { name });
const bars = (name: string) =>
  within(lane(name))
    .queryAllByRole("button")
    .filter((b) => !b.hasAttribute("aria-expanded"))
    .map((b) => b.getAttribute("aria-label"));

const stockBar = `${stockLabel} · Roast the bones, Simmer the stock, Strain the stock`;
const beurreBar = `${beurreLabel} · Reduce the shallots in the stock, Whisk in the butter`;
const velouteBar = "Velouté · Sweat the shallots, Add the stock and simmer, Blend and season";
const brineBar = "Duck breast with beurre blanc · Dry-brine the duck";
const duckBar = "Duck breast with beurre blanc · Score and season, Sear the duck";
const tarteBar = "Tarte tatin · Caramelise the apples, Bake the tart";
const pastryBar = `${pastryLabel} · Make the pastry`;

const everyLane = [
  "Velouté",
  "Chicken stock",
  "Duck breast with beurre blanc",
  "Beurre blanc",
  "Chicken stock (also shown above)",
  "Tarte tatin",
  "Pastry",
];

// A day's band on the axis, found by its day label, and where it starts.
function band(day: string) {
  const el = screen.getByText(day, { exact: false }).parentElement!;
  return { el, left: parseFloat(el.style.left) };
}
const ticks = (day: string) =>
  within(band(day).el)
    .getAllByText(/^\d\d:\d\d$/)
    .map((t) => t.textContent);

describe("the Gantt chart", () => {
  it("shows a lane per Dish with its Batches under it, the shared stock again under the Beurre blanc", () => {
    renderView(<Gantt plan={plan} courses={courses} onPin={noPin} />);
    expect(lanes()).toEqual(everyLane);
    expect(screen.getByText("Starter")).toBeTruthy();
    expect(screen.getByText("Main")).toBeTruthy();
    expect(screen.getByText("Dessert")).toBeTruthy();
    expect(screen.getAllByText("└ Chicken stock ×1.5")).toHaveLength(2);
    expect(screen.getByText("└ Beurre blanc ×1")).toBeTruthy();
    expect(screen.getByText("└ Pastry ×1")).toBeTruthy();
  });

  it("puts each Task in its owner's lane at its start in the kitchen's zone, and the shared stock's Task in both its lanes", () => {
    renderView(<Gantt plan={plan} courses={courses} onPin={noPin} />);
    expect(bars("Velouté")).toEqual([`${velouteBar} · 17:20`]);
    expect(bars("Chicken stock")).toEqual([`${stockBar} · 14:10`]);
    expect(bars("Duck breast with beurre blanc")).toEqual([
      `${brineBar} · 21:50`,
      `${duckBar} · 18:35`,
    ]);
    expect(bars("Beurre blanc")).toEqual([`${beurreBar} · 17:35`]);
    expect(bars("Chicken stock (also shown above)")).toEqual([`${stockBar} · 14:10`]);
    expect(bars("Tarte tatin")).toEqual([`${tarteBar} · 18:05`]);
    expect(bars("Pastry")).toEqual([`${pastryBar} · 20:30`]);
  });

  it("labels each day of the Plan and its whole hours in the kitchen's zone, with the nights removed", () => {
    renderView(<Gantt plan={plan} courses={courses} onPin={noPin} />);
    expect(ticks("Thu 29 Oct")).toEqual(["18:00", "19:00", "20:00", "21:00", "22:00"]);
    expect(ticks("Fri 30 Oct")).toEqual(["19:00", "20:00", "21:00"]);
    expect(ticks("Sat 31 Oct")).toEqual([
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
      "19:00",
    ]);
    expect(band("Thu 29 Oct").el.textContent).not.toContain("not available");
  });

  it("draws each bar from its start, one pixel a minute, active then passive time", () => {
    renderView(<Gantt plan={plan} courses={courses} onPin={noPin} />);
    // Each band starts at the Cook's first free minute that day.
    const [thursdayFree, , saturdayFree] = model.cooks[0].free;
    const cases = [
      { lane: "Chicken stock", bar: `${stockBar} · 14:10`, key: keys.stock },
      { lane: "Velouté", bar: `${velouteBar} · 17:20`, key: keys.veloute },
      { lane: "Beurre blanc", bar: `${beurreBar} · 17:35`, key: keys.beurre },
      { lane: "Duck breast with beurre blanc", bar: `${duckBar} · 18:35`, key: keys.duck },
    ];
    const saturday = band("Sat 31 Oct");
    for (const c of cases) {
      const el = within(lane(c.lane)).getByRole("button", { name: c.bar });
      const task = taskIn(plan, c.key);
      expect(parseFloat(el.style.left)).toBe(saturday.left + task.startMinute - saturdayFree.start);
      expect(parseFloat(el.style.width)).toBe(task.activeMinutes + task.passiveMinutes);
    }
    // The dry-brine starts near the end of Thursday's band.
    const brine = within(lane("Duck breast with beurre blanc")).getByRole("button", {
      name: `${brineBar} · 21:50`,
    });
    const thursday = band("Thu 29 Oct");
    expect(parseFloat(brine.style.left)).toBe(
      thursday.left + taskIn(plan, keys.brine).startMinute - thursdayFree.start,
    );
  });

  it("marks a date the Cook isn't available as not available", () => {
    const [thu, , sat] = model.cooks[0].free;
    const noFriday = { ...model, cooks: [{ id: "cook", free: [thu, sat] }] };
    renderView(<Gantt plan={planOf(noFriday)} courses={courses} onPin={noPin} />);
    expect(band("Fri 30 Oct").el.textContent).toContain("not available");
    expect(band("Sat 31 Oct").el.textContent).not.toContain("not available");
  });

  it("shows a pinned Task with a pin in each of its lanes", () => {
    const pinned = planOf({
      ...model,
      previous: [{ key: keys.stock, start: at(SATURDAY, 10), cookId: "cook", pinned: true }],
    });
    renderView(<Gantt plan={pinned} courses={courses} onPin={noPin} />);
    expect(bars("Chicken stock")).toEqual([`${stockBar} · 10:00 · pinned`]);
    expect(bars("Chicken stock (also shown above)")).toEqual([`${stockBar} · 10:00 · pinned`]);
    expect(
      screen.getAllByText("📌 Roast the bones, Simmer the stock, Strain the stock"),
    ).toHaveLength(2);
    expect(
      screen.getByText("Sweat the shallots, Add the stock and simmer, Blend and season"),
    ).toBeTruthy();
  });

  it("collapses a Dish into its own lane with its Batches' Tasks folded in once, and expands it again", () => {
    renderView(<Gantt plan={plan} courses={courses} onPin={noPin} />);
    expect(screen.getByRole("button", { name: "Collapse Velouté" })).toBeTruthy();
    const collapse = screen.getByRole("button", { name: "Collapse Duck breast with beurre blanc" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(collapse);
    expect(lanes()).toEqual([
      "Velouté",
      "Chicken stock",
      "Duck breast with beurre blanc",
      "Tarte tatin",
      "Pastry",
    ]);
    expect(bars("Duck breast with beurre blanc")).toEqual([
      `${brineBar} · 21:50`,
      `${duckBar} · 18:35`,
      `${beurreBar} · 17:35`,
      `${stockBar} · 14:10`,
    ]);
    const expand = screen.getByRole("button", { name: "Expand Duck breast with beurre blanc" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(expand);
    expect(lanes()).toEqual(everyLane);
    expect(bars("Duck breast with beurre blanc")).toEqual([
      `${brineBar} · 21:50`,
      `${duckBar} · 18:35`,
    ]);
  });

  it("collapses each Dish on its own", () => {
    renderView(<Gantt plan={plan} courses={courses} onPin={noPin} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Velouté" }));
    expect(lanes()).toEqual([
      "Velouté",
      "Duck breast with beurre blanc",
      "Beurre blanc",
      "Chicken stock (also shown above)",
      "Tarte tatin",
      "Pastry",
    ]);
    expect(bars("Velouté")).toEqual([`${velouteBar} · 17:20`, `${stockBar} · 14:10`]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Duck breast with beurre blanc" }));
    expect(lanes()).toEqual(["Velouté", "Duck breast with beurre blanc", "Tarte tatin", "Pastry"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Velouté" }));
    expect(lanes()).toEqual([
      "Velouté",
      "Chicken stock",
      "Duck breast with beurre blanc",
      "Tarte tatin",
      "Pastry",
    ]);
  });
});
