import { applyPlacements } from "@miseflow/shared/src/plan/pin.ts";
import { zonedMinute } from "@miseflow/shared/src/plan/time.ts";
import { schedule } from "@miseflow/shared/src/scheduler/schedule.ts";
import { taskKey, type Owner, type PlanningModel } from "@miseflow/shared/src/scheduler/types.ts";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderView } from "../test/render-view.tsx";
import type { Plan, PlanTask } from "./api.ts";
import { Gantt } from "./Gantt.tsx";

// A browser zone an hour off the kitchen's, so a time drawn in the browser's zone reads wrong.
vi.stubEnv("TZ", "UTC");

// The ADR 0004 walkthrough with its Chicken stock and Beurre blanc, cut to the Starter and Main:
// Sat 31 Oct 2026 at 19:30 in Paris, the Cook free Thu and Fri evenings and Saturday 09:00–19:00.
// The Plan is a real scheduler run over this model, laid over the read by `applyPlacements`.
const timeZone = "Europe/Paris";
const at = (date: string, hours: number, minutes = 0) =>
  zonedMinute(date, hours * 60 + minutes, timeZone);

const veloute = { id: "dish-veloute", name: "Velouté" };
const duck = { id: "dish-duck", name: "Duck breast with beurre blanc" };
const stock = { id: "batch-stock", subRecipe: { id: "sr-stock", name: "Chicken stock" } };
const beurre = { id: "batch-beurre", subRecipe: { id: "sr-beurre", name: "Beurre blanc" } };
const stockLabel = "Chicken stock ×1.5 · for: Velouté, Beurre blanc";
const beurreLabel = "Beurre blanc ×1 · for: Duck breast with beurre blanc";

const courses = [
  { id: "starter", name: "Starter", dishes: [veloute] },
  { id: "main", name: "Main", dishes: [duck] },
];

type Spec = {
  owner: Owner;
  steps: { id: string; text: string; active: number | null; passive?: number }[];
  earliestStart: number | null;
};
const thursday = at("2026-10-29", 18);
const specs: Spec[] = [
  {
    owner: { kind: "batch", batchId: stock.id },
    earliestStart: thursday,
    steps: [
      { id: "S1", text: "Roast the bones", active: 20 },
      { id: "S2", text: "Simmer the stock", active: 10, passive: 120 },
      { id: "S3", text: "Strain the stock", active: 10, passive: 30 },
    ],
  },
  {
    owner: { kind: "batch", batchId: beurre.id },
    earliestStart: thursday,
    steps: [
      { id: "B1", text: "Reduce the shallots in the stock", active: 10 },
      { id: "B2", text: "Whisk in the butter", active: 10 },
    ],
  },
  {
    owner: { kind: "dish", dishId: veloute.id },
    earliestStart: null,
    steps: [
      { id: "V1", text: "Sweat the shallots", active: 10 },
      { id: "V2", text: "Add the stock and simmer", active: 5, passive: 20 },
      { id: "V3", text: "Blend and season", active: 10 },
    ],
  },
  {
    owner: { kind: "dish", dishId: duck.id },
    earliestStart: thursday,
    steps: [{ id: "D1", text: "Dry-brine the duck", active: 10, passive: 1440 }],
  },
  {
    owner: { kind: "dish", dishId: duck.id },
    earliestStart: null,
    steps: [
      { id: "D2", text: "Score and season", active: 10 },
      { id: "D3", text: "Sear the duck", active: 15 },
    ],
  },
];
const keyOf = (spec: Spec) => taskKey(spec.owner, spec.steps[0].id);
const [stockTask, beurreTask, velouteTask, brineTask, duckTask] = specs.map(keyOf);

const model: PlanningModel = {
  service: { dayStart: at("2026-10-31", 0), at: at("2026-10-31", 19, 30) },
  cooks: [
    {
      id: "cook",
      free: [
        { start: at("2026-10-29", 18), end: at("2026-10-29", 22) },
        { start: at("2026-10-30", 19), end: at("2026-10-30", 21) },
        { start: at("2026-10-31", 9), end: at("2026-10-31", 19) },
      ],
    },
  ],
  tasks: specs.map((s) => ({
    owner: s.owner,
    earliestStart: s.earliestStart,
    steps: s.steps.map((step) => ({
      stepId: step.id,
      activeMinutes: step.active,
      passiveMinutes: step.passive ?? 0,
    })),
  })),
  links: [
    { before: stockTask, after: velouteTask },
    { before: stockTask, after: beurreTask },
    { before: beurreTask, after: duckTask },
    { before: brineTask, after: duckTask },
  ],
  previous: [],
};

// A read Task before placing; `applyPlacements` fills in its times.
function unplacedTask(spec: Spec): PlanTask {
  const sum = (part: "active" | "passive") =>
    spec.steps.reduce((total, s) => total + (s[part] ?? 0), 0);
  const { owner } = spec;
  const dish = owner.kind === "dish" ? [veloute, duck].find((d) => d.id === owner.dishId) : null;
  const batch =
    owner.kind === "batch"
      ? owner.batchId === stock.id
        ? { id: stock.id, label: stockLabel }
        : { id: beurre.id, label: beurreLabel }
      : null;
  return {
    key: keyOf(spec),
    owner: spec.owner,
    dish: dish ?? null,
    batch,
    steps: spec.steps.map((s) => ({ id: s.id, text: s.text, done: false, doneAt: null })),
    done: false,
    behind: null,
    start: "",
    startMinute: 0,
    end: "",
    endDate: "",
    activeMinutes: sum("active"),
    passiveMinutes: sum("passive"),
    approximate: false,
    pinned: false,
  };
}

const read: Plan = {
  service: {
    id: "service",
    menuId: "menu",
    date: "2026-10-31",
    time: "19:30",
    timeIsDefault: false,
  },
  timeZone,
  model,
  asOf: "Mon 26 Oct 13:00",
  approximate: false,
  days: [{ date: "2026-10-31", tasks: specs.map(unplacedTask) }],
  batches: [
    {
      ...stock,
      factor: 1.5,
      scalable: true,
      for: [
        { kind: "dish", id: veloute.id, name: veloute.name },
        { kind: "batch", id: beurre.subRecipe.id, name: beurre.subRecipe.name },
      ],
      label: stockLabel,
      fix: null,
    },
    {
      ...beurre,
      factor: 1,
      scalable: true,
      for: [{ kind: "dish", id: duck.id, name: duck.name }],
      label: beurreLabel,
      fix: null,
    },
  ],
  unplaced: [],
  conflicts: [],
};
const planOf = (m: PlanningModel) => applyPlacements({ ...read, model: m }, schedule(m));
const plan = planOf(model);
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
    expect(lanes()).toEqual([
      "Velouté",
      "Chicken stock",
      "Duck breast with beurre blanc",
      "Beurre blanc",
      "Chicken stock (also shown above)",
    ]);
    expect(screen.getByText("Starter")).toBeTruthy();
    expect(screen.getByText("Main")).toBeTruthy();
    expect(screen.getAllByText("└ Chicken stock ×1.5")).toHaveLength(2);
    expect(screen.getByText("└ Beurre blanc ×1")).toBeTruthy();
  });

  it("puts each Task in its owner's lane at its start in the kitchen's zone, and the shared stock's Task in both its lanes", () => {
    renderView(<Gantt plan={plan} courses={courses} onPin={noPin} />);
    expect(bars("Velouté")).toEqual([`${velouteBar} · 17:50`]);
    expect(bars("Chicken stock")).toEqual([`${stockBar} · 14:40`]);
    expect(bars("Duck breast with beurre blanc")).toEqual([
      `${brineBar} · 21:50`,
      `${duckBar} · 18:35`,
    ]);
    expect(bars("Beurre blanc")).toEqual([`${beurreBar} · 18:05`]);
    expect(bars("Chicken stock (also shown above)")).toEqual([`${stockBar} · 14:40`]);
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
    const cases = [
      // `after`: minutes from Saturday's first hour, 09:00. Roast the bones: 40 active, 150 passive.
      {
        lane: "Chicken stock",
        bar: `${stockBar} · 14:40`,
        day: "Sat 31 Oct",
        after: 340,
        width: 190,
      },
      { lane: "Velouté", bar: `${velouteBar} · 17:50`, day: "Sat 31 Oct", after: 530, width: 45 },
      {
        lane: "Beurre blanc",
        bar: `${beurreBar} · 18:05`,
        day: "Sat 31 Oct",
        after: 545,
        width: 20,
      },
      {
        lane: "Duck breast with beurre blanc",
        bar: `${duckBar} · 18:35`,
        day: "Sat 31 Oct",
        after: 575,
        width: 25,
      },
    ];
    for (const c of cases) {
      const el = within(lane(c.lane)).getByRole("button", { name: c.bar });
      const day = band(c.day);
      expect(parseFloat(el.style.left)).toBe(day.left + c.after);
      expect(parseFloat(el.style.width)).toBe(c.width);
    }
    // The dry-brine starts at the end of Thursday's band.
    const brine = within(lane("Duck breast with beurre blanc")).getByRole("button", {
      name: `${brineBar} · 21:50`,
    });
    const thursday = band("Thu 29 Oct");
    expect(parseFloat(brine.style.left)).toBe(thursday.left + 230);
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
      previous: [{ key: stockTask, start: at("2026-10-31", 10), cookId: "cook", pinned: true }],
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
    expect(screen.queryByRole("button", { name: "Collapse Velouté" })).toBeTruthy();
    const collapse = screen.getByRole("button", { name: "Collapse Duck breast with beurre blanc" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(collapse);
    expect(lanes()).toEqual(["Velouté", "Chicken stock", "Duck breast with beurre blanc"]);
    expect(bars("Duck breast with beurre blanc")).toEqual([
      `${brineBar} · 21:50`,
      `${duckBar} · 18:35`,
      `${beurreBar} · 18:05`,
      `${stockBar} · 14:40`,
    ]);
    const expand = screen.getByRole("button", { name: "Expand Duck breast with beurre blanc" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(expand);
    expect(lanes()).toEqual([
      "Velouté",
      "Chicken stock",
      "Duck breast with beurre blanc",
      "Beurre blanc",
      "Chicken stock (also shown above)",
    ]);
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
    ]);
    expect(bars("Velouté")).toEqual([`${velouteBar} · 17:50`, `${stockBar} · 14:40`]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Duck breast with beurre blanc" }));
    expect(lanes()).toEqual(["Velouté", "Duck breast with beurre blanc"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Velouté" }));
    expect(lanes()).toEqual(["Velouté", "Chicken stock", "Duck breast with beurre blanc"]);
  });
});
