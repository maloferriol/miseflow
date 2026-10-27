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

type StepSpec = {
  text: string;
  active: number | null;
  passive?: number | null;
  makeAhead?: { beforeDays: number; shelfLifeDays: number };
};

const RECIPES: {
  key: "veloute" | "duck" | "tarte";
  name: string;
  course: string;
  makeAhead?: { beforeDays: number; shelfLifeDays: number };
  steps: StepSpec[];
}[] = [
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
      {
        text: "Dry-brine the duck",
        active: 10,
        passive: 1440,
        makeAhead: { beforeDays: 2, shelfLifeDays: 3 },
      },
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

// With `{ stock: true }` (#87 D11 and owner decision 2), ADR 0004's sub-recipes join: Chicken stock
// (yield 2 L, 3 days ahead, keeps 4) used by the Velouté (servings 4, 1.5 L on V2) and by a
// Beurre blanc sub-recipe (yield 300 ml, 750 ml on B1), which the duck (servings 6) uses on D4.
// So the Velouté is ×1.5 and the Beurre blanc ×1, and the stock is (2.25 L + 0.75 L) / 2 L = ×1.5.
// The Beurre blanc can be made 2 days ahead, so it fits before the dry-brine (D1) that waits for it.
// S2's passive time is 120 minutes, not the #87 plan's illustrative 150: with the real scheduler the
// whole chain S1–S3, B1, B2 must fit Thu 18:00 to D1's start at 21:50, and with 150 S1 is Unplaced.
const SUB_RECIPES: {
  key: "stock" | "beurre";
  name: string;
  yield: string;
  makeAhead: { beforeDays: number; shelfLifeDays: number };
  steps: StepSpec[];
}[] = [
  {
    key: "stock",
    name: "Chicken stock",
    yield: "2 L",
    makeAhead: { beforeDays: 3, shelfLifeDays: 4 },
    steps: [
      { text: "Roast the bones", active: 20 },
      { text: "Simmer the stock", active: 10, passive: 120 },
      { text: "Strain the stock", active: 10, passive: 30 },
    ],
  },
  {
    key: "beurre",
    name: "Beurre blanc",
    yield: "300 ml",
    makeAhead: { beforeDays: 2, shelfLifeDays: 3 },
    steps: [
      { text: "Reduce the shallots in the stock", active: 10 },
      { text: "Whisk in the butter", active: 10 },
    ],
  },
];

type Line = { amount: string; wording: string; subRecipe: "stock" | "beurre" };
// Which walkthrough Step uses a sub-recipe, and how its text reads around the line.
const USES: Record<string, { before: string; line: Line; after: string }> = {
  V2: {
    before: "Add the ",
    line: { amount: "1.5%L", wording: "stock", subRecipe: "stock" },
    after: " and simmer",
  },
  D4: {
    before: "Make the ",
    line: { amount: "300%ml", wording: "beurre blanc", subRecipe: "beurre" },
    after: "",
  },
  B1: {
    before: "Reduce the shallots in the ",
    line: { amount: "750%ml", wording: "stock", subRecipe: "stock" },
    after: "",
  },
};
const SERVINGS: Partial<Record<string, number>> = { veloute: 4, duck: 6 };

// With `{ shopping }` (#91 owner decision 1), Steps gain Ingredient lines with small, plausible
// amounts, and the Tarte tatin's pastry Steps (T1, T2) move into a Pastry sub-recipe by
// Extract to sub-recipe, yield 1, used once. Flour is in grams: the seed has no flour Conversion
// (owner decision 2). The text around each line keeps the Step's own words.
type ShoppingIngredient = "shallot" | "butter" | "flour" | "salt" | "apple" | "sugar";
type IngredientUse = { amount: string; wording: string; ingredient: ShoppingIngredient };
const INGREDIENT_USES: Partial<Record<string, (string | IngredientUse)[]>> = {
  V1: ["Sweat the ", { amount: "100%g", wording: "shallots", ingredient: "shallot" }],
  B2: ["Whisk in the ", { amount: "200%g", wording: "butter", ingredient: "butter" }],
  T1: [
    "Make the pastry with ",
    { amount: "200%g", wording: "flour", ingredient: "flour" },
    ", ",
    { amount: "100%g", wording: "butter", ingredient: "butter" },
    " and ",
    { amount: "a pinch", wording: "salt", ingredient: "salt" },
  ],
  T3: [
    "Bake the tatin with ",
    { amount: "6", wording: "apples", ingredient: "apple" },
    " and ",
    { amount: "150%g", wording: "sugar", ingredient: "sugar" },
  ],
};

type StepKey = "V1" | "V2" | "V3" | "D1" | "D2" | "D3" | "D4" | "T1" | "T2" | "T3";
type SubStepKey = "S1" | "S2" | "S3" | "B1" | "B2";

export type Walkthrough = {
  menuId: string;
  recipes: {
    veloute: string;
    duck: string;
    tarte: string;
    stock?: string;
    beurre?: string;
    pastry?: string;
  };
  dishes: { veloute: string; duck: string; tarte: string };
  /** V1–V3, D1–D4, T1–T3 (and with the stock S1–S3, B1–B2): each Recipe's Steps in order. */
  steps: Record<StepKey, string> & Partial<Record<SubStepKey, string>>;
  names: {
    veloute: string;
    duck: string;
    tarte: string;
    stock?: string;
    beurre?: string;
    pastry?: string;
  };
};

export type WalkthroughOptions = {
  stock?: boolean;
  /** The catalog's Ingredient ids for the lines; implies `stock`. */
  shopping?: Record<ShoppingIngredient, string>;
};

/** The Recipes, their Planning pass, and the Menu with one Dish per Course. No Service. */
export async function buildWalkthrough(
  run: Run,
  stamp: string,
  options: WalkthroughOptions = {},
): Promise<Walkthrough> {
  const { shopping } = options;
  const stock = options.stock || !!shopping;
  const revisionId = () => crypto.randomUUID();
  const menuId = crypto.randomUUID();
  const dishIds = sortedIds(3);
  const out = { menuId, recipes: {}, dishes: {}, steps: {}, names: {} } as Walkthrough;
  const stepKey = (key: string, j: number) =>
    `${key === "beurre" ? "B" : key === "stock" ? "S" : key[0].toUpperCase()}${j + 1}`;

  // One Recipe's Steps in order, each after the previous one, with any sub-recipe line it uses.
  const addSteps = async (key: string, recipeId: string, steps: StepSpec[]) => {
    const stepIds = sortedIds(steps.length);
    for (const [j, s] of steps.entries()) {
      const stepId = stepIds[j];
      const named = stepKey(key, j);
      (out.steps as Record<string, string>)[named] = stepId;
      const use = stock ? USES[named] : undefined;
      const uses = shopping ? INGREDIENT_USES[named] : undefined;
      const lineId = crypto.randomUUID();
      const content = uses
        ? ingredientContent(uses, shopping!)
        : use
          ? {
              body: [
                { type: "text", text: use.before },
                { type: "line", lineId },
                ...(use.after ? [{ type: "text", text: use.after }] : []),
              ],
              lines: [
                {
                  lineId,
                  subRecipeId: out.recipes[use.line.subRecipe],
                  amount: use.line.amount,
                  wording: use.line.wording,
                },
              ],
            }
          : { body: [{ type: "text", text: s.text }], lines: [] };
      await run("addStep", { recipeId, stepId, revisionId: revisionId(), ...content });
      if (s.active !== null || s.passive != null)
        await run("setStepTimes", {
          stepId,
          revisionId: revisionId(),
          activeMinutes: s.active,
          passiveMinutes: s.passive ?? null,
        });
      if (s.makeAhead)
        await run("setMakeAhead", {
          target: { kind: "step", stepId },
          revisionId: revisionId(),
          window: s.makeAhead,
        });
      if (j > 0)
        await run("addStepDependency", {
          dependencyId: crypto.randomUUID(),
          revisionId: revisionId(),
          beforeStepId: stepIds[j - 1],
          afterStepId: stepId,
        });
    }
  };

  if (stock) {
    for (const r of SUB_RECIPES) {
      const recipeId = crypto.randomUUID();
      const name = `${r.name} ${stamp}`;
      out.recipes[r.key] = recipeId;
      out.names[r.key] = name;
      await run("createSubRecipe", { recipeId, revisionId: revisionId(), name, yield: r.yield });
      await run("setMakeAhead", {
        target: { kind: "recipe", recipeId },
        revisionId: revisionId(),
        window: r.makeAhead,
      });
      await addSteps(r.key, recipeId, r.steps);
    }
  }

  await run("createMenu", { menuId, name: `Saturday dinner ${stamp}`, guestCount: 6 });
  for (const [i, r] of RECIPES.entries()) {
    const recipeId = crypto.randomUUID();
    const name = `${r.name} ${stamp}`;
    out.recipes[r.key] = recipeId;
    out.names[r.key] = name;
    const servings = stock ? SERVINGS[r.key] : undefined;
    await run("createRecipe", {
      recipeId,
      revisionId: revisionId(),
      name,
      ...(servings ? { servings } : {}),
    });
    if (r.makeAhead)
      await run("setMakeAhead", {
        target: { kind: "recipe", recipeId },
        revisionId: revisionId(),
        window: r.makeAhead,
      });
    await addSteps(r.key, recipeId, r.steps);
    if (shopping && r.key === "tarte") {
      const pastryId = crypto.randomUUID();
      const name = `Pastry ${stamp}`;
      out.recipes.pastry = pastryId;
      out.names.pastry = name;
      await run("extractToSubRecipe", {
        recipeId,
        revisionId: revisionId(),
        stepIds: [out.steps.T1, out.steps.T2],
        subRecipeId: pastryId,
        subRecipeRevisionId: revisionId(),
        name,
        stepId: crypto.randomUUID(),
        lineId: crypto.randomUUID(),
      });
      await run("setYield", { recipeId: pastryId, revisionId: revisionId(), yield: "1" });
    }
    const courseId = crypto.randomUUID();
    await run("addCourse", { courseId, menuId, name: r.course });
    await run("addDish", { dishId: dishIds[i], courseId, recipeId });
    out.dishes[r.key] = dishIds[i]!;
  }
  return out;
}

// A Step's text and Ingredient lines, from its parts in order.
function ingredientContent(
  parts: (string | IngredientUse)[],
  ids: Record<ShoppingIngredient, string>,
) {
  const body: unknown[] = [];
  const lines: unknown[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      body.push({ type: "text", text: part });
      continue;
    }
    const lineId = crypto.randomUUID();
    body.push({ type: "line", lineId });
    lines.push({
      lineId,
      ingredientId: ids[part.ingredient],
      amount: part.amount,
      wording: part.wording,
    });
  }
  return { body, lines };
}

/** Thu and Fri 18:00–22:00, Sat 09:00–19:00, and the override Fri 30 Oct from `fridayStart` to 21:00. */
export async function setWalkthroughAvailability(run: Run, fridayStart = h(19)) {
  const row = (weekday: number, start: number, end: number) => ({
    availabilityId: crypto.randomUUID(),
    weekday,
    start,
    end,
  });
  await run("setWeeklyAvailability", {
    hours: [row(4, h(18), h(22)), row(5, h(18), h(22)), row(6, h(9), h(19))],
  });
  await run("setAvailabilityOverride", {
    overrideId: crypto.randomUUID(),
    date: "2026-10-30",
    availability: { kind: "hours", start: fridayStart, end: h(21) },
  });
}

/** The walkthrough Service: Sat 31 Oct 2026 at 19:30. */
export const SERVICE_DATE = "2026-10-31";
export const SERVICE_TIME = h(19, 30);
