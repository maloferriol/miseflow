import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

// The local database isn't reset between runs. Load the seed (idempotent) and soft-delete the
// test user's "Espelette pepper" and its aliases from an earlier run, so creating it again isn't
// refused as a duplicate. Local stack only.
test.beforeAll(async () => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  });
  try {
    const [user] =
      await sql`select id from auth.users where email = ${process.env.TEST_USER_EMAIL!}`;
    if (!user)
      throw new Error("No local test user. Run npm run setup:local first.");
    const mine = await sql`
      update ingredients set deleted_at = now()
      where owner_id = ${user.id} and lower(name) = 'espelette pepper' and deleted_at is null
      returning id`;
    await sql`
      update ingredient_aliases set deleted_at = now()
      where owner_id = ${user.id} and deleted_at is null
        and (ingredient_id = any(${mine.map((row) => row.id)}::uuid[]) or lower(name) = 'piment d''espelette')`;
  } finally {
    await sql.end();
  }
});

test("creates an Ingredient 'Espelette pepper' in Spices and finds it by a new alias", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Catalog" }).click();

  await page.getByLabel("Ingredient name").fill("Espelette pepper");
  await page.getByLabel("Kind of measure").selectOption("mass");
  await page.getByLabel("Shopping category").selectOption({ label: "Spices" });
  await page.getByRole("button", { name: "Create Ingredient" }).click();

  const created = page
    .getByRole("listitem")
    .filter({ hasText: "Espelette pepper" });
  await expect(created).toBeVisible();
  await created.getByLabel("Alias").fill("Piment d'Espelette");
  await created.getByRole("button", { name: "Add alias" }).click();
  await expect(created).toContainText("Piment d'Espelette");

  await page.getByLabel("Search ingredients").fill("piment d'espelette");

  const results = page
    .getByRole("list", { name: "Ingredients" })
    .getByRole("listitem");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("Espelette pepper");
  await expect(results.first()).toContainText("Spices");
});
