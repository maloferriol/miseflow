import { execFileSync } from "node:child_process";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { zonedMinute } from "../shared/src/plan/time.ts";
import { dragTo, starts } from "./gantt-helpers.ts";
import { createTestUser, deleteTestUser, type TestUser } from "./test-user.ts";
import { heading, week } from "./walkthrough-week.ts";

// ADR 0004's "Done looks like", steps 1–8 in order, as one story through the UI only (#230).
// The per-feature specs each build their world through POST /mutate; this one types it all in,
// as shared/test/walkthrough.ts does with `{ shopping }`: the same Steps, times and windows,
// typed through the Recipe screen and its Planning pass. One user, one page, serial steps.
test.describe.configure({ mode: "serial" });

const timeZone = "Europe/Paris";
const at = (date: string, hours: number, minutes = 0) =>
  zonedMinute(date, hours * 60 + minutes, timeZone);
// No stamps: the Recipes and the new Ingredient are this spec's own user's.
const stockLabel = "Chicken stock ×1.5 · for: Velouté, Beurre blanc";
const newIngredient = "calvados";
// Where step 5 pins the stock's first Task.
const wednesday1805 = at(week.wednesday, 18, 5);

let user: TestUser;
let page: Page;
// Step 8's fresh browser session.
let context: BrowserContext | undefined;

test.beforeAll(async ({ browser }) => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  user = await createTestUser("walkthrough");
  page = await browser.newPage();
});

// deleteTestUser hard-deletes every row this spec's user owns.
test.afterAll(async () => {
  await page?.close();
  await context?.close();
  if (user) await deleteTestUser(user);
});

/** Waits for the next POST /api/mutate to be applied. */
const mutated = () =>
  page.waitForResponse(
    (r) => r.url().endsWith("/api/mutate") && r.request().method() === "POST" && r.ok(),
  );

/** The Recipe screen's re-read of its Recipe. */
const RECIPE = /\/api\/recipes\//;

/**
 * Runs `act` and waits for the mutation it sends to be applied. With `reread`, also waits for the
 * re-read it starts and a frame to render it: the Recipe screen's forms are keyed on the Revision,
 * so a field filled before then is reset.
 */
async function saving(act: () => Promise<void>, reread?: RegExp) {
  const done = mutated();
  const reRead =
    reread &&
    page.waitForResponse((r) => r.request().method() === "GET" && reread.test(r.url()) && r.ok());
  await act();
  await done;
  if (reRead) {
    await reRead;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))),
    );
  }
}

async function signIn(p: Page) {
  await p.goto("/");
  await p.getByLabel("Email").fill(user.email);
  await p.getByLabel("Password").fill(user.password);
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/** Opens a Recipe from the Recipes screen's list. */
async function openRecipe(name: string) {
  await page.getByRole("button", { name: "Recipes" }).click();
  await page
    .getByRole("list", { name: "Recipes" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

const stepItems = () => page.getByRole("list", { name: "Steps" }).locator(":scope > li");

/**
 * Adds a Step. `link` handles the Link choice an unmatched name opens before the Save that
 * stores the Step.
 */
async function addStep(text: string, link?: () => Promise<void>) {
  const count = await stepItems().count();
  await page.getByRole("button", { name: "Add Step" }).click();
  await page.getByLabel("Step text").fill(text);
  const save = page.getByRole("button", { name: "Save", exact: true });
  if (link) {
    await save.click();
    await link();
  }
  await saving(() => save.click(), RECIPE);
  await expect(stepItems()).toHaveCount(count + 1);
}

async function setServings(servings: string) {
  await page.getByLabel("Servings").fill(servings);
  await saving(() => page.getByRole("button", { name: "Save Recipe" }).click(), RECIPE);
}

async function setYield(value: string) {
  await page.getByLabel("Yield").fill(value);
  await saving(() => page.getByRole("button", { name: "Save yield" }).click(), RECIPE);
}

const linkGroup = (name: string) => page.getByRole("group", { name: `Link ‘${name}’` });

/** The Planning pass's rows, after switching the Recipe screen to it. */
async function planningPass() {
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Plan" }).click();
  return page.getByRole("list", { name: "Planning" }).locator(":scope > li");
}
const readyToPlan = () => page.getByRole("list", { name: "Ready to plan" }).getByRole("listitem");

async function saveTimes(row: Locator, active: string, passive = "") {
  await row.getByLabel("Active minutes").fill(active);
  await row.getByLabel("Passive minutes").fill(passive);
  await saving(() => row.getByRole("button", { name: "Save times" }).click(), RECIPE);
}

/** Each Step from the second on waits for the one before it, as the walkthrough's links. */
async function chainSteps(rows: Locator) {
  const n = await rows.count();
  for (let i = 1; i < n; i++) {
    const row = rows.nth(i);
    // The choices leave out the row's own Step, so the one before it is option `i` (0 is blank).
    await row.getByLabel("Waits for").selectOption({ index: i });
    await saving(() => row.getByRole("button", { name: "Add" }).click(), RECIPE);
    await expect(rows.nth(i).getByRole("list", { name: "Waits for" })).toBeVisible();
  }
}

async function setRecipeWindow(beforeDays: string, shelfLifeDays: string) {
  await page.getByLabel("Days ahead").first().fill(beforeDays);
  await page.getByLabel("Shelf life (days)").first().fill(shelfLifeDays);
  await saving(() => page.getByRole("button", { name: "Save window" }).click(), RECIPE);
}

async function setStepWindow(row: Locator, beforeDays: string, shelfLifeDays: string) {
  await row.getByLabel("Own make-ahead window").check();
  await row.getByLabel("Days ahead").fill(beforeDays);
  await row.getByLabel("Shelf life (days)").fill(shelfLifeDays);
  await saving(() => row.getByRole("button", { name: "Save", exact: true }).click(), RECIPE);
}

async function openMenu() {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Your Menus" })
    .getByRole("link", { name: "Saturday dinner" })
    .click();
  await expect(page.getByRole("heading", { name: "Saturday dinner" })).toBeVisible();
}

async function openPlan() {
  await openMenu();
  await page.getByRole("link", { name: "Open Plan" }).click();
  const gantt = page.getByRole("region", { name: "Gantt chart" });
  await expect(gantt).toBeVisible();
  return gantt;
}

async function setFridayOverride(from: string, to: string) {
  await page.getByLabel("Date", { exact: true }).fill(week.friday);
  await page.getByLabel("From").last().fill(from);
  await page.getByLabel("To").last().fill(to);
  await saving(() => page.getByRole("button", { name: "Save override", exact: true }).click());
  await expect(page.getByRole("list", { name: "Date overrides" })).toContainText(
    `${week.friday}: ${from}–${to}`,
  );
}

test("1. types the three Recipes, with Create sub-recipe, Extract to sub-recipe and a new Ingredient", async () => {
  await signIn(page);

  // Add Dish makes the Recipe, so the Menu and its Courses come first.
  await page.getByLabel("Menu name").fill("Saturday dinner");
  await page.getByLabel("Guests").fill("6");
  await page.getByRole("button", { name: "Create Menu" }).click();
  await expect(page.getByRole("heading", { name: "Saturday dinner" })).toBeVisible();
  for (const [course, dish] of [
    ["Starter", "Velouté"],
    ["Main", "Duck breast with beurre blanc"],
    ["Dessert", "Tarte tatin"],
  ] as const) {
    await page.getByLabel("Course name").fill(course);
    await page.getByRole("button", { name: "Add Course" }).click();
    const article = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: course }) });
    await expect(article).toBeVisible();
    await article.getByLabel("Recipe name").fill(dish);
    await article.getByRole("button", { name: "Add Dish" }).click();
    await expect(article.getByRole("link", { name: dish })).toBeVisible();
  }

  // Velouté: the stock is made with Create sub-recipe.
  await page.getByRole("link", { name: "Velouté" }).click();
  await expect(page.getByRole("heading", { name: "Velouté" })).toBeVisible();
  await setServings("4");
  await addStep("Sweat the @shallots{100%g}");
  await addStep("Add the @chicken stock{1.5%L} and simmer", async () => {
    const link = linkGroup("chicken stock");
    await expect(link.getByLabel("Name for the sub-recipe")).toHaveValue("Chicken stock");
    await link.getByRole("button", { name: "Create sub-recipe" }).click();
    await expect(link).toBeHidden();
  });
  await addStep("Blend and season");
  await expect(
    page.getByRole("button", { name: /^chicken stock 1\.5 L · sub-recipe/ }),
  ).toBeVisible();

  await openRecipe("Chicken stock");
  await setYield("2 L");
  for (const text of ["Roast the bones", "Simmer the stock", "Strain the stock"])
    await addStep(text);

  // The duck: its beurre blanc is a sub-recipe that uses the stock again.
  await openMenu();
  await page.getByRole("link", { name: "Duck breast with beurre blanc" }).click();
  await setServings("6");
  for (const text of ["Dry-brine the duck", "Score and season", "Sear the duck"])
    await addStep(text);
  await addStep("Make the @beurre blanc{300%ml}", async () => {
    const link = linkGroup("beurre blanc");
    await link.getByRole("button", { name: "Create sub-recipe" }).click();
    await expect(link).toBeHidden();
  });

  await openRecipe("Beurre blanc");
  await setYield("300 ml");
  // The name is the stock's, so it links on its own.
  await addStep("Reduce the shallots in the @chicken stock{750%ml}");
  await expect(
    page.getByRole("button", { name: /^chicken stock 750 ml · sub-recipe/ }),
  ).toBeVisible();
  await addStep("Whisk in the @butter{200%g}");

  // Tarte tatin: calvados matches nothing in the catalog, so it is created.
  await openMenu();
  await page.getByRole("link", { name: "Tarte tatin" }).click();
  await addStep("Make the pastry with @flour{200%g}, @butter{100%g} and @salt{a pinch}");
  await addStep("Chill the pastry");
  await addStep(
    `Bake the tatin with @apples{6}, @sugar{150%g} and @${newIngredient}{2%tbsp}`,
    async () => {
      await linkGroup(newIngredient).getByRole("button", { name: "Create Ingredient" }).click();
      await expect(linkGroup(newIngredient)).toBeHidden();
    },
  );

  // The pastry moves out with Extract to sub-recipe.
  await page.getByLabel("Select Step 1").check();
  await page.getByLabel("Select Step 2").check();
  const extract = page.getByRole("group", { name: "Extract to sub-recipe" });
  await extract.getByLabel("Name for the sub-recipe").fill("Pastry");
  await saving(
    () => extract.getByRole("button", { name: "Extract to sub-recipe" }).click(),
    RECIPE,
  );
  await expect(stepItems()).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Pastry 1 · sub-recipe/ })).toBeVisible();
  await openRecipe("Pastry");
  await setYield("1");
  await expect(stepItems()).toHaveCount(2);

  // Every Ingredient line is linked: the Recipe's list names each one's catalog Ingredient.
  await openRecipe("Tarte tatin");
  await expect(page.getByRole("list", { name: "Ingredients" })).toContainText(newIngredient);
});

test("2. the Planning pass: times, make-ahead windows and links; Ready to plan lists what is missing", async () => {
  // Velouté: Ready to plan lists every Step, then the one still missing a duration.
  await openRecipe("Velouté");
  let rows = await planningPass();
  await expect(readyToPlan()).toHaveCount(3);
  await saveTimes(rows.nth(0), "10");
  await saveTimes(rows.nth(1), "5", "20");
  await expect(readyToPlan()).toHaveCount(1);
  await expect(readyToPlan().first()).toContainText("Step 3 · Blend and season has no duration");
  await saveTimes(rows.nth(2), "10");
  await expect(readyToPlan()).toHaveCount(0);
  await chainSteps(rows);

  // The stock can be made 3 days ahead and keeps 4.
  await openRecipe("Chicken stock");
  rows = await planningPass();
  await setRecipeWindow("3", "4");
  await saveTimes(rows.nth(0), "20");
  await saveTimes(rows.nth(1), "10", "120");
  await saveTimes(rows.nth(2), "10", "30");
  await chainSteps(rows);

  await openRecipe("Beurre blanc");
  rows = await planningPass();
  await setRecipeWindow("2", "3");
  await saveTimes(rows.nth(0), "10");
  await saveTimes(rows.nth(1), "10");
  await chainSteps(rows);

  // The duck's beurre blanc Step keeps no duration: the Plan shows it as approximate.
  await openRecipe("Duck breast with beurre blanc");
  rows = await planningPass();
  await saveTimes(rows.nth(0), "10", "1440");
  await setStepWindow(rows.nth(0), "2", "3");
  await saveTimes(rows.nth(1), "10");
  await saveTimes(rows.nth(2), "15");
  await expect(readyToPlan()).toHaveCount(1);
  await expect(readyToPlan().first()).toContainText(
    "Step 4 · Make the beurre blanc has no duration",
  );
  await chainSteps(rows);

  await openRecipe("Pastry");
  rows = await planningPass();
  await setRecipeWindow("1", "2");
  await saveTimes(rows.nth(0), "20");
  await saveTimes(rows.nth(1), "0", "1330");
  await chainSteps(rows);

  await openRecipe("Tarte tatin");
  rows = await planningPass();
  await setRecipeWindow("1", "2");
  await saveTimes(rows.nth(1), "40");
  await setStepWindow(rows.nth(1), "0", "0");
  await chainSteps(rows);
});

test("3. the Menu has three Courses and 6 guests, a Service Saturday 19:30, and the Cook's Availability", async () => {
  await openMenu();
  await expect(page.getByText("6 guests")).toBeVisible();
  for (const course of ["Starter", "Main", "Dessert"])
    await expect(page.getByRole("heading", { name: course })).toBeVisible();

  await page.getByLabel("Service date").fill(week.saturday);
  await page.getByLabel("Service time (optional)").fill("19:30");
  await saving(() => page.getByRole("button", { name: "Add Service", exact: true }).click());
  await expect(page.getByRole("link", { name: "Open Plan" })).toBeVisible();

  await page.getByRole("button", { name: "Availability" }).click();
  const weekly: Record<string, [string, string] | null> = {
    Sunday: null,
    Monday: null,
    Tuesday: null,
    Wednesday: null,
    Thursday: ["18:00", "22:00"],
    Friday: ["18:00", "22:00"],
    Saturday: ["09:00", "19:00"],
  };
  for (const [day, hours] of Object.entries(weekly)) {
    const group = page.getByRole("group", { name: day });
    await group.getByLabel("Available").setChecked(hours !== null);
    if (hours) {
      await group.getByLabel("From").fill(hours[0]);
      await group.getByLabel("To").fill(hours[1]);
    }
  }
  await saving(() => page.getByRole("button", { name: "Save week", exact: true }).click());
  // The walkthrough's Friday evening: 19:00–21:00.
  await setFridayOverride("19:00", "21:00");
});

test("4. the Plan: the stock is one Batch on Thursday, the pastry on Friday, the rest on Saturday", async () => {
  await openPlan();
  const plan = page.getByRole("region", { name: "Plan" });
  const day = (date: string) =>
    plan.getByRole("list", { name: heading(date) }).getByRole("listitem");
  const texts = async (date: string) => (await day(date).allInnerTexts()).join("\n");

  const thursday = await texts(week.thursday);
  for (const step of ["Roast the bones", "Simmer the stock", "Strain the stock"])
    expect(thursday).toContain(`${stockLabel} · ${step}`);
  // One Batch: no other day makes the stock.
  await expect(plan.getByText(/Chicken stock ×/)).toHaveCount(3);

  const friday = await texts(week.friday);
  expect(friday).toContain("Pastry ×1 · for: Tarte tatin · Make the pastry");
  expect(friday).toContain("Pastry ×1 · for: Tarte tatin · Chill the pastry");

  const saturday = await texts(week.saturday);
  for (const step of [
    "Velouté · Sweat the shallots",
    "Velouté · Add the chicken stock and simmer",
    "Velouté · Blend and season",
    "Duck breast with beurre blanc · Score and season",
    "Duck breast with beurre blanc · Sear the duck",
    "Duck breast with beurre blanc · Make the beurre blanc",
    "Tarte tatin · Bake the tatin",
  ])
    expect(saturday).toContain(step);
});

test("5. dragging the stock to Wednesday pins it; a shorter Friday leaves the pastry Unplaced until the Cook gets more time", async () => {
  let gantt = await openPlan();
  const roast = gantt
    .getByRole("button", { name: /Roast the bones/ })
    .and(gantt.locator('[data-ghost="false"]'));
  const roastKey = (await roast.getAttribute("data-key"))!;
  const before = await starts(gantt);
  await saving(() => dragTo(page, gantt, roast, wednesday1805));
  await expect(roast).toHaveAttribute("data-start", String(wednesday1805));
  await expect(roast).toHaveAttribute("data-pinned", "true");
  // The re-fit: every other Task was already as late as it can be, so it stays put.
  expect(await starts(gantt)).toEqual({ ...before, [roastKey]: String(wednesday1805) });

  // Friday shortened to 19:35–21:00 through the Availability screen.
  await openMenu();
  await page.getByRole("button", { name: "Availability" }).click();
  await setFridayOverride("19:35", "21:00");

  gantt = await openPlan();
  const unplaced = page.getByRole("list", { name: "Unplaced Tasks" }).getByRole("listitem");
  await expect(unplaced).toHaveCount(1);
  // The UI's ids are random, so the scheduler's ties, and the window's end, vary by run.
  await expect(unplaced.first()).toContainText(
    /^Pastry ×1 · for: Tarte tatin · Make the pastry with flour, butter and salt: No Cook has 20 free minutes between Fri 00:00 and Fri \d\d:\d\d/,
  );
  await expect(page.getByRole("status", { name: "Plan trouble: 1" })).toBeVisible();
  const pastry = gantt.getByRole("button", { name: /Make the pastry/ });
  await expect(pastry).toHaveCount(0);

  await saving(() =>
    unplaced.first().getByRole("button", { name: "Give the Cook more time" }).click(),
  );
  await expect(page.getByText("Every Task is planned")).toBeVisible();
  await expect(page.getByRole("status", { name: /Plan trouble/ })).toHaveCount(0);
  await expect(pastry).not.toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Plan" }).getByRole("list", { name: heading(week.friday) }),
  ).toContainText("Make the pastry");
  await expect(roast).toHaveAttribute("data-start", String(wednesday1805));
});

test("6. the Shopping list prints its rows without the app chrome, and two rows are ticked Got", async () => {
  await openMenu();
  await page.getByRole("link", { name: "Open Shopping list" }).click();
  await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();

  await page.emulateMedia({ media: "print" });
  const rows = (category: string) =>
    page.getByRole("list", { name: category }).getByRole("listitem");
  await expect(rows("Produce")).toHaveText(["apple 6", "shallot 150 g"]);
  await expect(rows("Dairy & eggs")).toHaveText(["butter 300 g"]);
  await expect(rows("Dry goods")).toHaveText(["all-purpose flour 200 g", "sugar 150 g"]);
  await expect(rows("Spices")).toHaveText(["salt a pinch"]);
  // The Ingredient step 1 created.
  await expect(rows("Other")).toHaveText([`${newIngredient} 30 ml`]);
  await expect(page.getByRole("checkbox", { name: newIngredient })).toBeVisible();
  await expect(page.getByRole("navigation")).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  for (const name of ["butter", "apple"]) {
    await saving(() => page.getByRole("checkbox", { name }).check());
    await expect(page.getByRole("checkbox", { name })).toBeChecked();
  }
});

test("7. the Today checklist: a Step ticked on the stock's new day", async () => {
  await openPlan();
  await page.getByRole("link", { name: "Today checklist" }).click();
  await page.getByRole("tab", { name: heading(week.wednesday) }).click();
  const box = page.getByRole("checkbox", { name: "Roast the bones" });
  await expect(box).not.toBeChecked();
  await saving(() => box.check());
  await expect(box).toBeChecked();
});

// The server measures behind at its real clock, and the walkthrough week is two weeks out, so no
// tick can be late; page.clock (as today.spec.ts uses it) only fakes the browser's clock.
test.fixme("7. a late tick shows a Task as behind and re-plans the rest (#234)", async () => {});

test("8. a new browser session finds the Recipes, Menu, Plan pin, Got ticks and Step tick saved", async ({
  browser,
}) => {
  await page.close();
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);

  await page.getByRole("button", { name: "Recipes" }).click();
  const recipes = page.getByRole("list", { name: "Recipes" });
  for (const name of [
    "Velouté",
    "Chicken stock",
    "Duck breast with beurre blanc",
    "Beurre blanc",
    "Tarte tatin",
    "Pastry",
  ])
    await expect(recipes.getByRole("link", { name, exact: true })).toBeVisible();
  await openRecipe("Velouté");
  await expect(
    page.getByRole("button", { name: /^chicken stock 1\.5 L · sub-recipe/ }),
  ).toBeVisible();

  await openMenu();
  await expect(page.getByText("6 guests")).toBeVisible();
  for (const [course, dish] of [
    ["Starter", "Velouté"],
    ["Main", "Duck breast with beurre blanc"],
    ["Dessert", "Tarte tatin"],
  ] as const)
    await expect(
      page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: course }) })
        .getByRole("link", { name: dish }),
    ).toBeVisible();

  const gantt = await openPlan();
  const roast = gantt
    .getByRole("button", { name: /Roast the bones/ })
    .and(gantt.locator('[data-ghost="false"]'));
  await expect(roast).toHaveAttribute("data-start", String(wednesday1805));
  await expect(roast).toHaveAttribute("data-pinned", "true");
  await expect(page.getByText("Every Task is planned")).toBeVisible();

  await page.getByRole("link", { name: "Today checklist" }).click();
  await page.getByRole("tab", { name: heading(week.wednesday) }).click();
  await expect(page.getByRole("checkbox", { name: "Roast the bones" })).toBeChecked();

  await openMenu();
  await page.getByRole("link", { name: "Open Shopping list" }).click();
  await expect(page.getByRole("checkbox", { name: "butter" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "apple" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "sugar" })).not.toBeChecked();
});
