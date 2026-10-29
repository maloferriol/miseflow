import { batchLabel, toBatchRead } from "@miseflow/shared/src/plan/batches.ts";
import { applyPlacements } from "@miseflow/shared/src/plan/pin.ts";
import { describeConflict, describeUnplaced } from "@miseflow/shared/src/plan/reasons.ts";
import { zonedMinute } from "@miseflow/shared/src/plan/time.ts";
import { schedule } from "@miseflow/shared/src/scheduler/schedule.ts";
import { type PlanningModel, taskKey } from "@miseflow/shared/src/scheduler/types.ts";
import type { Menu, Plan, PlanTask } from "../src/api.ts";

// A Plan read for the Plan screen's tests, built by running the scheduler over a small model of
// ADR 0004's Saturday dinner, the way `readPlan` builds it: the scheduler places the Tasks, and
// the reasons and conflicts are its own, worded by the shared sentences. Nothing is hand-timed.

const timeZone = "Europe/Paris";
const friday = "2026-10-30";
const saturday = "2026-10-31";
const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedMinute(date, h * 60 + m, timeZone);
};

type Dish = { id: string; name: string };
const velouté: Dish = { id: "d-veloute", name: "Velouté" };
const duck: Dish = { id: "d-duck", name: "Duck breast" };
const tarte: Dish = { id: "d-tarte", name: "Tarte tatin" };

/** One Task per Dish, of one Step; `active: null` is a Step with no duration. */
const specs = [
  // Last-minute, with passive time after.
  { dish: velouté, step: "s-sweat", text: "Sweat the onions", active: 20, passive: 90 },
  // Approximate, pinned the evening before but keeps only 30 minutes: a conflict.
  { dish: duck, step: "s-sear", text: "Sear the duck", active: null, passive: 0 },
  // Longer than the Cook's whole Saturday: Unplaced.
  { dish: tarte, step: "s-pastry", text: "Make the pastry", active: 600, passive: 0 },
];
const ownerOf = (dish: Dish) => ({ kind: "dish" as const, dishId: dish.id });
const keyOf = (spec: (typeof specs)[number]) => taskKey(ownerOf(spec.dish), spec.step);
const duckKey = keyOf(specs[1]);

export const model: PlanningModel = {
  service: { dayStart: at(saturday, "00:00"), at: at(saturday, "19:30") },
  cooks: [
    {
      id: "cook-1",
      free: [
        { start: at(friday, "16:00"), end: at(friday, "22:00") },
        { start: at(saturday, "14:00"), end: at(saturday, "19:30") },
      ],
    },
  ],
  tasks: specs.map((s) => ({
    owner: ownerOf(s.dish),
    steps: [{ stepId: s.step, activeMinutes: s.active, passiveMinutes: s.passive }],
    earliestStart: s.dish === duck ? at(friday, "00:00") : null,
    keepsMinutes: s.dish === duck ? 30 : null,
  })),
  links: [],
  previous: [{ key: duckKey, start: at(friday, "17:00"), cookId: "cook-1", pinned: true }],
};

const run = schedule(model);
const placedKeys = new Set(run.placements.map((p) => p.key));
const specOf = (key: string) => specs.find((s) => keyOf(s) === key)!;
const describe = (spec: (typeof specs)[number]) => ({
  dish: spec.dish,
  batch: null,
  steps: [{ id: spec.step, text: spec.text }],
});
// "Sear the duck (Duck breast)", as `readPlan` names a Task.
const taskLabel = (key: string) => `${specOf(key).text} (${specOf(key).dish.name})`;

// Each placed Task before the scheduler's times are laid over it by `applyPlacements`.
const unplacedTimes = { start: "", startMinute: 0, end: "", endDate: saturday, pinned: false };
const tasks: PlanTask[] = specs
  .filter((s) => placedKeys.has(keyOf(s)))
  .map((s) => ({
    key: keyOf(s),
    owner: ownerOf(s.dish),
    ...describe(s),
    steps: [{ id: s.step, text: s.text, done: false, doneAt: null }],
    done: false,
    behind: null,
    // The scheduler counts a Step with no duration as 10 active minutes.
    activeMinutes: s.active ?? 10,
    passiveMinutes: s.passive,
    approximate: s.active === null,
    ...unplacedTimes,
  }));

// The Service's one Batch, labelled by the shared Batch label.
const chickenStock = {
  subRecipeId: "r-stock",
  name: "Chicken stock",
  factor: 1.5,
  scalable: true,
  parents: [{ kind: "dish" as const, id: velouté.id, name: velouté.name }],
  fix: null,
};
export const chickenStockLabel = batchLabel(chickenStock);

const read: Plan = {
  service: {
    id: "s-saturday",
    menuId: "m-dinner",
    date: saturday,
    time: "19:30",
    timeIsDefault: false,
  },
  timeZone,
  model,
  asOf: "Sat 31 Oct 17:35",
  approximate: tasks.some((t) => t.approximate),
  days: [{ date: saturday, tasks }],
  batches: [toBatchRead(chickenStock, "b-stock")],
  unplaced: run.unplaced.map((u) => {
    const spec = specOf(u.key);
    return {
      key: u.key,
      ...describe(spec),
      kind: u.reason.kind,
      sentence: describeUnplaced(
        u.reason,
        {
          key: u.key,
          owner: ownerOf(spec.dish),
          dishId: spec.dish.id,
          batchId: null,
          stepIds: [spec.step],
          activeMinutes: spec.active ?? 10,
          passiveMinutes: spec.passive,
          trailingPassiveMinutes: spec.passive,
          approximate: spec.active === null,
        },
        timeZone,
        (key) => specOf(key).text,
      ),
      blockingPin: null,
      dishes: [spec.dish],
      moreTime: u.reason.kind !== "WindowTooTight",
    };
  }),
  conflicts: run.conflicts.map((c) => ({
    key: c.key,
    kind: c.kind,
    ...describe(specOf(c.key)),
    use: { key: null, label: "Service" },
    sentence: describeConflict(c, taskLabel, timeZone),
  })),
};

/** Saturday dinner's Plan: three Tasks, one Unplaced, one conflict and one Batch. */
export const saturdayPlan: Plan = applyPlacements(read, run);

/** The same Plan with nothing Unplaced, no conflicts and no Batches. */
export const calmPlan: Plan = { ...saturdayPlan, unplaced: [], conflicts: [], batches: [] };

/** The Menu the Plan is for: one Course per Dish. */
export const saturdayMenu: Menu = {
  id: "m-dinner",
  name: "Saturday dinner",
  guestCount: 6,
  batches: [],
  service: null,
  courses: [velouté, duck, tarte].map((dish, i) => ({
    id: `c-${i}`,
    name: ["Starter", "Main", "Dessert"][i],
    position: `a${i}`,
    dishes: [
      {
        id: dish.id,
        position: "a0",
        recipe: { id: `r-${dish.id}`, name: dish.name },
        scale: { factor: 1, source: "assumed" as const },
        fixes: [],
      },
    ],
  })),
};
