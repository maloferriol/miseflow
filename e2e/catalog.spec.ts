import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createTestUser, deleteTestUser, type TestUser } from "./test-user.ts";

let user: TestUser;

test.beforeAll(async () => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  user = await createTestUser("catalog");
});

// Soft-deletes the Ingredients and aliases this run's user made ("Espelette pepper"), then the user. Local stack only.
test.afterAll(async () => {
  if (!user) return;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql`update ingredient_aliases set deleted_at = now() where owner_id = ${user.id} and deleted_at is null`;
    await sql`update ingredients set deleted_at = now() where owner_id = ${user.id} and deleted_at is null`;
  } finally {
    await sql.end();
  }
  await deleteTestUser(user);
});

test("creates an Ingredient 'Espelette pepper' in Spices and finds it by a new alias", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Catalog" }).click();

  await page.getByLabel("Ingredient name").fill("Espelette pepper");
  await page.getByLabel("Kind of measure").selectOption("mass");
  await page.getByLabel("Shopping category").selectOption({ label: "Spices" });
  await page.getByRole("button", { name: "Create Ingredient" }).click();

  const created = page.getByRole("listitem").filter({ hasText: "Espelette pepper" });
  await expect(created).toBeVisible();
  await created.getByLabel("Alias").fill("Piment d'Espelette");
  await created.getByRole("button", { name: "Add alias" }).click();
  await expect(created).toContainText("Piment d'Espelette");

  await page.getByLabel("Search ingredients").fill("piment d'espelette");

  const results = page.getByRole("list", { name: "Ingredients" }).getByRole("listitem");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("Espelette pepper");
  await expect(results.first()).toContainText("Spices");
});
