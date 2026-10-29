import type { Plan, PlanTask } from "../src/api.ts";

// ADR 0004's Saturday dinner for 6 as the server reads its Plan, cut to what the Today checklist
// and the printed Plan show: the stock lands on Thursday as one Batch, the pastry on Friday and
// the rest on Saturday, in the kitchen's zone (Europe/Paris).

export const SERVICE_ID = "s-saturday";
export const THURSDAY = "2026-10-29";
export const FRIDAY = "2026-10-30";
export const SATURDAY = "2026-10-31";

const stock = { id: "b-stock", label: "Chicken stock ×1.5 · for: Velouté, Beurre blanc" };

/** A placed Task with no Step done, nothing behind and nothing pinned. */
function task(
  fields: Pick<PlanTask, "key" | "owner" | "dish" | "batch" | "steps" | "start" | "end" | "endDate">,
): PlanTask {
  return {
    ...fields,
    done: false,
    behind: null,
    startMinute: 0,
    activeMinutes: 20,
    passiveMinutes: 0,
    approximate: false,
    pinned: false,
  };
}

export const roastTheBones = task({
  key: "batch:b-stock:0",
  owner: { kind: "batch", batchId: stock.id },
  dish: null,
  batch: stock,
  steps: [{ id: "st-roast", text: "Roast the bones", done: false, doneAt: null }],
  start: "18:20",
  end: "18:40",
  endDate: THURSDAY,
});

// Simmers past midnight, so it ends on Friday.
export const simmerTheStock = task({
  key: "batch:b-stock:1",
  owner: { kind: "batch", batchId: stock.id },
  dish: null,
  batch: stock,
  steps: [
    { id: "st-cover", text: "Cover with water", done: false, doneAt: null },
    { id: "st-simmer", text: "Simmer the stock", done: false, doneAt: null },
  ],
  start: "21:50",
  end: "00:10",
  endDate: FRIDAY,
});

export const makeThePastry = task({
  key: "dish:d-tatin:0",
  owner: { kind: "dish", dishId: "d-tatin" },
  dish: { id: "d-tatin", name: "Tarte tatin" },
  batch: null,
  steps: [{ id: "st-pastry", text: "Make the pastry", done: false, doneAt: null }],
  start: "19:00",
  end: "19:30",
  endDate: FRIDAY,
});

export const sweatTheShallots = task({
  key: "dish:d-veloute:0",
  owner: { kind: "dish", dishId: "d-veloute" },
  dish: { id: "d-veloute", name: "Velouté" },
  batch: null,
  steps: [{ id: "st-sweat", text: "Sweat the shallots", done: true, doneAt: "17:05" }],
  start: "17:00",
  end: "17:15",
  endDate: SATURDAY,
});

export const scoreTheDuck = task({
  key: "dish:d-duck:0",
  owner: { kind: "dish", dishId: "d-duck" },
  dish: { id: "d-duck", name: "Duck breast" },
  batch: null,
  steps: [{ id: "st-score", text: "Score the duck", done: false, doneAt: null }],
  start: "18:30",
  end: "18:45",
  endDate: SATURDAY,
});

/** The walkthrough's Plan, with nothing behind, nothing Unplaced and no conflicts. */
export function walkthroughPlan(change: Partial<Plan> = {}): Plan {
  return {
    service: {
      id: SERVICE_ID,
      menuId: "m-dinner",
      date: SATURDAY,
      time: "19:30",
      timeIsDefault: false,
    },
    timeZone: "Europe/Paris",
    model: { service: { dayStart: 0, at: 0 }, cooks: [], tasks: [], links: [], previous: [] },
    asOf: "Thu 29 Oct 17:00",
    approximate: false,
    days: [
      { date: THURSDAY, tasks: [roastTheBones, simmerTheStock] },
      { date: FRIDAY, tasks: [makeThePastry] },
      { date: SATURDAY, tasks: [sweatTheShallots, scoreTheDuck] },
    ],
    batches: [],
    unplaced: [],
    conflicts: [],
    ...change,
  };
}

/** The walkthrough's Plan with Friday's pastry behind: due at 19:30, holding up the tart. */
export function pastryBehindPlan(): Plan {
  const plan = walkthroughPlan();
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      tasks: day.tasks.map((t) =>
        t === makeThePastry
          ? {
              ...t,
              behind: {
                dueAt: "19:30",
                dueDate: FRIDAY,
                holdsUp: [{ key: "dish:d-tatin:1", label: "Tarte tatin · Bake the tart" }],
              },
            }
          : t,
      ),
    })),
  };
}
