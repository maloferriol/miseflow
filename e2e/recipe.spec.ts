import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

// The seed (idempotent) has "shallot" and "butter", which the Step's refs link to on their own.
test.beforeAll(() => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
});

test("writes a Step with two linked Ingredient lines, keeps the chips after a reload, and stores a Revision", async ({
  page,
}) => {
  const name = `E2E sauce ${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Recipes" }).click();
  await page.getByLabel("Recipe name").fill(name);
  await page.getByRole("button", { name: "Create Recipe" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("button", { name: "Add Step" }).click();
  await page
    .getByLabel("Step text")
    .fill("Sweat @shallots{2}(brunoise) in @butter{30%g}");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: /^shallots/ })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "shallots 2 · brunoise" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "butter 30 g" })).toBeVisible();
  const ingredients = page
    .getByRole("list", { name: "Ingredients" })
    .getByRole("listitem");
  await expect(ingredients).toHaveCount(2);
  await expect(ingredients.nth(0)).toHaveText(/2 shallots, brunoise/);
  await expect(ingredients.nth(1)).toHaveText(/30 g butter/);

  // Revision 2 or later is stored, and it is the Recipe's latest. Local stack only.
  const recipeId = new URL(page.url()).searchParams.get("recipe")!;
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  });
  try {
    const [row] = await sql`
      select r.latest_revision, max(v.number) as max, count(v.*)::int as count
      from recipes r join recipe_revisions v on v.recipe_id = r.id
      where r.id = ${recipeId} group by r.id`;
    expect(row!.max).toBeGreaterThanOrEqual(2);
    expect(row!.max).toBe(row!.latest_revision);
    expect(row!.count).toBe(row!.max);
    const [unlinked] = await sql`
      select count(*)::int as count from ingredient_lines l join steps s on s.id = l.step_id
      where s.recipe_id = ${recipeId} and l.deleted_at is null and l.ingredient_id is null`;
    expect(unlinked!.count).toBe(0);
  } finally {
    await sql.end();
  }
});
