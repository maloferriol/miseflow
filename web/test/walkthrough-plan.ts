import {
  batchLabel,
  formatFactor,
  type SizedBatch,
  toBatchRead,
} from "@miseflow/shared/src/plan/batches.ts";
import { behindTasks } from "@miseflow/shared/src/plan/behind.ts";
import type { TaskInfo } from "@miseflow/shared/src/plan/model.ts";
import { applyPlacements, withPin } from "@miseflow/shared/src/plan/pin.ts";
import { stepKey, type StepState } from "@miseflow/shared/src/plan/progress.ts";
import { describeConflict, describeUnplaced } from "@miseflow/shared/src/plan/reasons.ts";
import {
  formatInstant,
  formatMinuteOfDay,
  localParts,
  zonedMinute,
} from "@miseflow/shared/src/plan/time.ts";
import { schedule } from "@miseflow/shared/src/scheduler/schedule.ts";
import {
  type Minute,
  type Owner,
  type PlanningModel,
  type TaskKey,
  taskKey,
} from "@miseflow/shared/src/scheduler/types.ts";
import type { Menu, Plan, PlanTask } from "../src/api.ts";

// ADR 0004's walkthrough ("Done looks like"): Saturday dinner for 6, a velouté on a chicken stock,
// a duck breast with a beurre blanc that also uses the stock, and a tarte tatin with its pastry
// moved out to a sub-recipe. The Cook is free Thursday and Friday evenings and Saturday, and the
// Service is on Saturday 31 October 2026 at 19:30 in Paris.
//
// Every Plan here is read the way `readPlan` reads one: the scheduler places the Tasks and
// `applyPlacements` lays its times over the read, behind is `behindTasks` at a clock, and the
// reasons and conflicts are the scheduler's, worded by the shared sentences. Nothing is hand-timed.

export const timeZone = "Europe/Paris";
export const SERVICE_ID = "s-saturday";
export const MENU_ID = "m-dinner";
export const TUESDAY = "2026-10-27";
export const THURSDAY = "2026-10-29";
export const FRIDAY = "2026-10-30";
export const SATURDAY = "2026-10-31";

/** A kitchen-zone date and time as a scheduler Minute. */
export const at = (date: string, hours: number, minutes = 0) =>
  zonedMinute(date, hours * 60 + minutes, timeZone);

export const veloute = { id: "d-veloute", name: "Velouté" };
export const duck = { id: "d-duck", name: "Duck breast with beurre blanc" };
export const tarte = { id: "d-tarte", name: "Tarte tatin" };
const dishes = [veloute, duck, tarte];

// The Batches, sized as the Plan read sizes them: the stock feeds the Velouté and the Beurre blanc.
const sized = {
  stock: {
    subRecipeId: "r-stock",
    name: "Chicken stock",
    factor: 1.5,
    scalable: true,
    parents: [
      { kind: "dish", id: veloute.id, name: veloute.name },
      { kind: "batch", id: "r-beurre", name: "Beurre blanc" },
    ],
    fix: null,
  },
  beurre: {
    subRecipeId: "r-beurre",
    name: "Beurre blanc",
    factor: 1,
    scalable: true,
    parents: [{ kind: "dish", id: duck.id, name: duck.name }],
    fix: null,
  },
  pastry: {
    subRecipeId: "r-pastry",
    name: "Pastry",
    factor: 1,
    scalable: true,
    parents: [{ kind: "dish", id: tarte.id, name: tarte.name }],
    fix: null,
  },
} satisfies Record<string, SizedBatch>;
const batchIds = { stock: "b-stock", beurre: "b-beurre", pastry: "b-pastry" } as const;
const batches = (Object.keys(sized) as (keyof typeof sized)[]).map((b) =>
  toBatchRead(sized[b], batchIds[b]),
);

/** "Chicken stock ×1.5 · for: Velouté, Beurre blanc", the shared Batch label. */
export const stockLabel = batchLabel(sized.stock);
export const beurreLabel = batchLabel(sized.beurre);
export const pastryLabel = batchLabel(sized.pastry);

type Spec = {
  owner: Owner;
  /** `active: null`: a Step with no duration yet, as Ready to plan lists it. */
  steps: { id: string; text: string; active: number | null; passive?: number }[];
  earliestStart: Minute | null;
  keepsMinutes?: number;
};
const batch = (b: keyof typeof batchIds): Owner => ({ kind: "batch", batchId: batchIds[b] });
const dish = (d: { id: string }): Owner => ({ kind: "dish", dishId: d.id });

const specs: Spec[] = [
  {
    // Made up to 3 days ahead, keeps 4.
    owner: batch("stock"),
    earliestStart: at(SATURDAY, 0) - 3 * 1440,
    keepsMinutes: 4 * 1440,
    steps: [
      { id: "S1", text: "Roast the bones", active: 20 },
      { id: "S2", text: "Simmer the stock", active: 10, passive: 120 },
      { id: "S3", text: "Strain the stock", active: 10, passive: 30 },
    ],
  },
  {
    owner: batch("beurre"),
    earliestStart: at(THURSDAY, 18),
    steps: [
      { id: "B1", text: "Reduce the shallots in the stock", active: 10 },
      { id: "B2", text: "Whisk in the butter", active: 10 },
    ],
  },
  {
    owner: dish(veloute),
    earliestStart: null,
    steps: [
      { id: "V1", text: "Sweat the shallots", active: 10 },
      { id: "V2", text: "Add the stock and simmer", active: 5, passive: 20 },
      { id: "V3", text: "Blend and season", active: null },
    ],
  },
  {
    owner: dish(duck),
    earliestStart: at(THURSDAY, 18),
    steps: [{ id: "D1", text: "Dry-brine the duck", active: 10, passive: 1440 }],
  },
  {
    owner: dish(duck),
    earliestStart: null,
    steps: [
      { id: "D2", text: "Score and season", active: 10 },
      { id: "D3", text: "Sear the duck", active: 15 },
    ],
  },
  {
    // Made the day before, to rest overnight.
    owner: batch("pastry"),
    earliestStart: at(FRIDAY, 0),
    steps: [{ id: "P1", text: "Make the pastry", active: 30, passive: 720 }],
  },
  {
    owner: dish(tarte),
    earliestStart: null,
    steps: [
      { id: "T1", text: "Caramelise the apples", active: 20 },
      { id: "T2", text: "Bake the tart", active: 10, passive: 40 },
    ],
  },
];
const keyOf = (spec: Spec) => taskKey(spec.owner, spec.steps[0].id);
const specOf = new Map(specs.map((s) => [keyOf(s), s]));

/** Each Task's key, by what it makes. */
export const keys = {
  stock: keyOf(specs[0]),
  beurre: keyOf(specs[1]),
  veloute: keyOf(specs[2]),
  brine: keyOf(specs[3]),
  duck: keyOf(specs[4]),
  pastry: keyOf(specs[5]),
  tarte: keyOf(specs[6]),
};

// The scheduler's view of a Task, as `toPlanningModel` builds it.
function infoOf(key: TaskKey): TaskInfo {
  const spec = specOf.get(key)!;
  const { owner } = spec;
  const passive = (s: Spec["steps"][number]) => s.passive ?? 0;
  return {
    key,
    owner,
    dishId: owner.kind === "dish" ? owner.dishId : null,
    batchId: owner.kind === "batch" ? owner.batchId : null,
    stepIds: spec.steps.map((s) => s.id),
    // The scheduler counts a Step with no duration as 10 active minutes.
    activeMinutes: spec.steps.reduce((sum, s) => sum + (s.active ?? 10), 0),
    passiveMinutes: spec.steps.reduce((sum, s) => sum + passive(s), 0),
    trailingPassiveMinutes: passive(spec.steps.at(-1)!),
    approximate: spec.steps.some((s) => s.active === null),
  };
}

export const model: PlanningModel = {
  service: { dayStart: at(SATURDAY, 0), at: at(SATURDAY, 19, 30) },
  cooks: [
    {
      id: "cook",
      free: [
        { start: at(THURSDAY, 18), end: at(THURSDAY, 22) },
        { start: at(FRIDAY, 19), end: at(FRIDAY, 21) },
        { start: at(SATURDAY, 9), end: at(SATURDAY, 19) },
      ],
    },
  ],
  tasks: specs.map((s) => ({
    owner: s.owner,
    earliestStart: s.earliestStart,
    keepsMinutes: s.keepsMinutes ?? null,
    steps: s.steps.map((step) => ({
      stepId: step.id,
      activeMinutes: step.active,
      passiveMinutes: step.passive ?? 0,
    })),
  })),
  links: [
    { before: keys.stock, after: keys.veloute },
    { before: keys.stock, after: keys.beurre },
    { before: keys.beurre, after: keys.duck },
    { before: keys.brine, after: keys.duck },
    { before: keys.pastry, after: keys.tarte },
  ],
  previous: [],
};

/** The model with Friday's hours taken away, as when the cook shortens them. */
export const withoutFriday = (m: PlanningModel): PlanningModel => ({
  ...m,
  cooks: m.cooks.map((c) => ({
    ...c,
    free: c.free.filter((f) => localParts(f.start, timeZone).date !== FRIDAY),
  })),
});

/** A Step ticked done: the Task it's in, the Step, and when. */
export type Tick = { key: TaskKey; stepId: string; at: Minute };

const describeTask = (key: TaskKey) => {
  const info = infoOf(key);
  const spec = specOf.get(key)!;
  return {
    dish: info.dishId === null ? null : dishes.find((d) => d.id === info.dishId)!,
    batch:
      info.batchId === null
        ? null
        : { id: info.batchId, label: batches.find((b) => b.id === info.batchId)!.label },
    steps: spec.steps.map((s) => ({ id: s.id, text: s.text })),
  };
};
// "Duck breast with beurre blanc · Score and season, Sear the duck", as `readPlan` names a line.
const lineOf = (key: TaskKey) => {
  const d = describeTask(key);
  return `${d.batch?.label ?? d.dish?.name} · ${d.steps.map((s) => s.text).join(", ")}`;
};
// "Strain the stock (Chicken stock ×1.5)", "Blend and season (Velouté)".
const taskLabel = (key: TaskKey) => {
  const d = describeTask(key);
  const b = batches.find((b) => b.id === d.batch?.id);
  const owner = b ? `${b.subRecipe.name} ${formatFactor(b.factor)}` : d.dish!.name;
  return `${d.steps[0].text} (${owner})`;
};
// The top-level Dishes a Task feeds, for "Remove <Dish>".
const dishesOf = (key: TaskKey): { id: string; name: string }[] => {
  const info = infoOf(key);
  if (info.dishId !== null) return [dishes.find((d) => d.id === info.dishId)!];
  const fed = new Set<string>();
  const visit = (subRecipeId: string) => {
    for (const p of batches.find((b) => b.subRecipe.id === subRecipeId)!.for)
      if (p.kind === "dish") fed.add(p.id);
      else visit(p.id);
  };
  visit(batches.find((b) => b.id === info.batchId)!.subRecipe.id);
  return dishes.filter((d) => fed.has(d.id));
};

const clock = (minute: Minute) => {
  const p = localParts(minute, timeZone);
  return { date: p.date, time: formatMinuteOfDay(p.minuteOfDay) };
};

/**
 * The Plan read over `m`: its Tasks placed by a scheduler run, the `ticks` done, and behind measured
 * at `now` (by default Monday 26 October, before any Task is due).
 */
export function planOf(
  m: PlanningModel = model,
  { ticks = [], now = at("2026-10-26", 13) }: { ticks?: Tick[]; now?: Minute } = {},
): Plan {
  const doneAt = new Map(ticks.map((t) => [`${t.key}:${t.stepId}`, t.at]));
  const ticked: PlanningModel = {
    ...m,
    tasks: m.tasks.map((t) => ({
      ...t,
      steps: t.steps.map((s) => {
        const tick = doneAt.get(`${taskKey(t.owner, t.steps[0].stepId)}:${s.stepId}`);
        return tick === undefined ? s : { ...s, doneAt: tick };
      }),
    })),
  };
  const run = schedule(ticked);
  const states = new Map<string, StepState>(
    ticks.map((t) => [
      stepKey(specOf.get(t.key)!.owner, t.stepId),
      { done: true, doneAt: new Date(t.at * 60_000) },
    ]),
  );
  const behind = behindTasks({
    placements: run.placements,
    tasks: new Map(specs.map((s) => [keyOf(s), infoOf(keyOf(s))])),
    links: ticked.links,
    states,
    now,
  });
  const placedKeys = new Set(run.placements.map((p) => p.key));

  // Each placed Task before `applyPlacements` lays the scheduler's times over it.
  const tasks: PlanTask[] = specs
    .map(keyOf)
    .filter((key) => placedKeys.has(key))
    .map((key) => {
      const info = infoOf(key);
      const described = describeTask(key);
      const steps = described.steps.map((s) => {
        const tick = doneAt.get(`${key}:${s.id}`);
        return {
          ...s,
          done: tick !== undefined,
          doneAt: tick === undefined ? null : clock(tick).time,
        };
      });
      const late = behind.get(key);
      return {
        key,
        owner: info.owner,
        ...described,
        steps,
        done: steps.every((s) => s.done),
        behind: late
          ? {
              dueAt: clock(late.dueAt).time,
              dueDate: clock(late.dueAt).date,
              holdsUp: late.holdsUp.map((k) => ({ key: k, label: lineOf(k) })),
            }
          : null,
        start: "",
        startMinute: 0,
        end: "",
        endDate: "",
        activeMinutes: info.activeMinutes,
        passiveMinutes: info.passiveMinutes,
        approximate: info.approximate,
        pinned: false,
      };
    });

  const read: Plan = {
    service: {
      id: SERVICE_ID,
      menuId: MENU_ID,
      date: SATURDAY,
      time: "19:30",
      timeIsDefault: false,
    },
    timeZone,
    model: ticked,
    asOf: formatInstant(new Date(now * 60_000), timeZone),
    approximate: tasks.some((t) => t.approximate),
    days: [{ date: SATURDAY, tasks }],
    batches,
    unplaced: run.unplaced.map((u) => ({
      key: u.key,
      ...describeTask(u.key),
      kind: u.reason.kind,
      sentence: describeUnplaced(
        u.reason,
        infoOf(u.key),
        timeZone,
        (k) => describeTask(k).steps[0].text,
      ),
      blockingPin: null,
      dishes: dishesOf(u.key),
      moreTime: u.reason.kind !== "WindowTooTight",
    })),
    conflicts: run.conflicts.map((c) => {
      const use = c.kind === "Outrun" ? c.by : c.use;
      return {
        key: c.key,
        kind: c.kind,
        ...describeTask(c.key),
        use: { key: use, label: use === null ? "Service" : taskLabel(use) },
        sentence: describeConflict(c, taskLabel, timeZone),
      };
    }),
  };
  return applyPlacements(read, run);
}

/** Thursday 22:00: the cook has dry-brined the duck, on time. */
export const brined: Tick = { key: keys.brine, stepId: "D1", at: at(THURSDAY, 22) };

/**
 * The walkthrough's Plan read on Thursday at 22:05, changed by `change`: every Task placed, the
 * duck dry-brined, nothing behind and no conflicts.
 */
export const walkthroughPlan = (change: Partial<Plan> = {}): Plan => ({
  ...planOf(model, { ticks: [brined], now: at(THURSDAY, 22, 5) }),
  ...change,
});

/** The same Plan read on Friday at 21:05, the pastry not made: behind, holding up the tart. */
export const pastryBehindPlan = (): Plan =>
  planOf(model, { ticks: [brined], now: at(FRIDAY, 21, 5) });

/**
 * Walkthrough step 5 gone wrong: the stock dragged to Tuesday, past its 4 days' keeping (a
 * conflict), and Friday's hours taken away, so the pastry goes Unplaced.
 */
export const troubledModel = withPin(withoutFriday(model), keys.stock, at(TUESDAY, 10));
export const troubledPlan = planOf(troubledModel);

/** The placed Task `key` in `plan`. */
export const taskIn = (plan: Plan, key: TaskKey) =>
  plan.days.flatMap((d) => d.tasks).find((t) => t.key === key)!;

/** The date `plan` places the Task `key` on. */
export const dayOf = (plan: Plan, key: TaskKey) =>
  plan.days.find((d) => d.tasks.some((t) => t.key === key))!.date;

/** The Menu the Plan is for: one Course per Dish. */
export const saturdayMenu: Menu = {
  id: MENU_ID,
  name: "Saturday dinner",
  guestCount: 6,
  batches: [],
  service: null,
  courses: dishes.map((d, i) => ({
    id: `c-${i}`,
    name: ["Starter", "Main", "Dessert"][i],
    position: `a${i}`,
    dishes: [
      {
        id: d.id,
        position: "a0",
        recipe: { id: `r-${d.id}`, name: d.name },
        scale: { factor: 1, source: "assumed" as const },
        fixes: [],
      },
    ],
  })),
};
