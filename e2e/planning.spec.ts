import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createTestUser, deleteTestUser, type TestUser } from "./test-user.ts";

// Seeds the same way recipe.spec.ts does (idempotent).
let user: TestUser;

test.beforeAll(async () => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  user = await createTestUser("planning");
});

test.afterAll(async () => {
  if (user) await deleteTestUser(user);
});

test("sets times on every Step but one, sees it in ready to plan, fills it in, and the checklist empties", async ({
  page,
}) => {
  const name = `Chicken stock ${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Recipes" }).click();
  await page.getByLabel("Recipe name").fill(name);
  await page.getByRole("button", { name: "Create Recipe" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  const steps = page.getByRole("list", { name: "Steps" }).locator(":scope > li");
  const texts = ["Roast the bones", "Simmer for four hours", "Strain and cool"];
  for (const [index, text] of texts.entries()) {
    await page.getByRole("button", { name: "Add Step" }).click();
    await page.getByLabel("Step text").fill(text);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(steps).toHaveCount(index + 1);
  }

  await page.getByRole("button", { name: "Plan" }).click();
  const rows = page.getByRole("list", { name: "Planning" }).locator(":scope > li");
  await expect(rows).toHaveCount(3);
  const ready = page.getByRole("list", { name: "Ready to plan" }).getByRole("listitem");
  await expect(ready).toHaveCount(3);

  async function saveTimes(index: number, active: string, passive: string) {
    const row = rows.nth(index);
    await row.getByLabel("Active minutes").fill(active);
    await row.getByLabel("Passive minutes").fill(passive);
    await row.getByRole("button", { name: "Save times" }).click();
  }
  await saveTimes(0, "20", "60");
  await expect(ready).toHaveCount(2);
  await saveTimes(2, "10", "30");

  await expect(ready).toHaveCount(1);
  await expect(ready.first()).toContainText("Simmer");

  await saveTimes(1, "5", "240");
  await expect(ready).toHaveCount(0);
  await expect(page.getByText("Every Step has a duration")).toBeVisible();

  // A reload stays in the Planning pass, and the times are saved.
  await page.reload();
  await expect(page.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(3);
  await expect(ready).toHaveCount(0);
  await expect(rows.nth(1).getByLabel("Passive minutes")).toHaveValue("240");

  // createRecipe, three addStep and three setStepTimes: 7 Revisions. Local stack only.
  const recipeId = new URL(page.url()).searchParams.get("recipe")!;
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  });
  try {
    const [row] = await sql`
      select r.latest_revision, count(v.*)::int as count
      from recipes r join recipe_revisions v on v.recipe_id = r.id
      where r.id = ${recipeId} group by r.id`;
    expect(row).toEqual({ latest_revision: 7, count: 7 });
  } finally {
    await sql.end();
  }
});
