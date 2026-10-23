// The ADR 0004 walkthrough without sub-recipes (D11): a Saturday dinner for 6 with three Recipes,
// built through `run(name, args)`, so the shared rollback tests, the server tests (POST /mutate)
// and the e2e (Playwright `request`) all build the same Menu.
//
// T2's passive time is 1330 minutes, not the plan's 1315: with the real scheduler, 1330 is what
// puts T2 at Fri 19:50, so the pastry (T1) lands inside Friday's override and AC5's sentence ends
// at Fri 19:50.

export type Run = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

// Ascending random UUIDs, so the scheduler's ties by key always break the same way (D11).
const sortedIds = (n: number) => Array.from({ length: n }, () => crypto.randomUUID()).sort();

type StepSpec = { text: string; active: number | null; passive?: number | null; makeAhead?: { beforeDays: number; shelfLifeDays: number } };

const RECIPES: { key: "veloute" | "duck" | "tarte"; name: string; course: string; makeAhead?: { beforeDays: number; shelfLifeDays: number }; steps: StepSpec[] }[] = [
  {
    key: "veloute",
    name: "Velouté",
    course: "Starter",
    steps: [
      { text: "Sweat the shallots", active: 10 },
      { text: "Add the stock and simmer", active: 5, passive: 20 },
      { text: "Blend and season", active: 10 },
    ],
  },
  {
    key: "duck",
    name: "Duck breast with beurre blanc",
    course: "Main",
    steps: [
      { text: "Dry-brine the duck", active: 10, passive: 1440, makeAhead: { beforeDays: 2, shelfLifeDays: 3 } },
      { text: "Score and season", active: 10 },
      { text: "Sear the duck", active: 15 },
      { text: "Make the beurre blanc", active: null },
    ],
  },
  {
    key: "tarte",
    name: "Tarte tatin",
    course: "Dessert",
    makeAhead: { beforeDays: 1, shelfLifeDays: 2 },
    steps: [
      { text: "Make the pastry", active: 20 },
      { text: "Chill the pastry", active: 0, passive: 1330 },
      { text: "Bake the tatin", active: 40, makeAhead: { beforeDays: 0, shelfLifeDays: 0 } },
    ],
  },
];

export type Walkthrough = {
  menuId: string;
  recipes: { veloute: string; duck: string; tarte: string };
  dishes: { veloute: string; duck: string; tarte: string };
  /** V1–V3, D1–D4, T1–T3: each Recipe's Steps in order. */
  steps: Record<"V1" | "V2" | "V3" | "D1" | "D2" | "D3" | "D4" | "T1" | "T2" | "T3", string>;
  names: { veloute: string; duck: string; tarte: string };
};

/** The three Recipes, their Planning pass, and the Menu with one Dish per Course. No Service. */
export async function buildWalkthrough(run: Run, stamp: string): Promise<Walkthrough> {
  const revisionId = () => crypto.randomUUID();
  const menuId = crypto.randomUUID();
  const dishIds = sortedIds(3);
  const out = { menuId, recipes: {}, dishes: {}, steps: {}, names: {} } as Walkthrough;

  await run("createMenu", { menuId, name: `Saturday dinner ${stamp}`, guestCount: 6 });
  for (const [i, r] of RECIPES.entries()) {
    const recipeId = crypto.randomUUID();
    const name = `${r.name} ${stamp}`;
    out.recipes[r.key] = recipeId;
    out.names[r.key] = name;
    await run("createRecipe", { recipeId, revisionId: revisionId(), name });
    if (r.makeAhead) await run("setMakeAhead", { target: { kind: "recipe", recipeId }, revisionId: revisionId(), window: r.makeAhead });
    const stepIds = sortedIds(r.steps.length);
    for (const [j, s] of r.steps.entries()) {
      const stepId = stepIds[j]!;
      (out.steps as Record<string, string>)[`${r.key[0]!.toUpperCase()}${j + 1}`] = stepId;
      await run("addStep", { recipeId, stepId, revisionId: revisionId(), body: [{ type: "text", text: s.text }], lines: [] });
      if (s.active !== null || s.passive != null)
        await run("setStepTimes", { stepId, revisionId: revisionId(), activeMinutes: s.active, passiveMinutes: s.passive ?? null });
      if (s.makeAhead) await run("setMakeAhead", { target: { kind: "step", stepId }, revisionId: revisionId(), window: s.makeAhead });
      if (j > 0)
        await run("addStepDependency", { dependencyId: crypto.randomUUID(), revisionId: revisionId(), beforeStepId: stepIds[j - 1], afterStepId: stepId });
    }
    const courseId = crypto.randomUUID();
    await run("addCourse", { courseId, menuId, name: r.course });
    await run("addDish", { dishId: dishIds[i], courseId, recipeId });
    out.dishes[r.key] = dishIds[i]!;
  }
  return out;
}

/** Thu and Fri 18:00–22:00, Sat 09:00–19:00, and the override Fri 30 Oct from `fridayStart` to 21:00. */
export async function setWalkthroughAvailability(run: Run, fridayStart = h(19)) {
  const row = (weekday: number, start: number, end: number) => ({ availabilityId: crypto.randomUUID(), weekday, start, end });
  await run("setWeeklyAvailability", { hours: [row(4, h(18), h(22)), row(5, h(18), h(22)), row(6, h(9), h(19))] });
  await run("setAvailabilityOverride", {
    overrideId: crypto.randomUUID(),
    date: "2026-10-30",
    availability: { kind: "hours", start: fridayStart, end: h(21) },
  });
}

/** The walkthrough Service: Sat 31 Oct 2026 at 19:30. */
export const SERVICE_DATE = "2026-10-31";
export const SERVICE_TIME = h(19, 30);
