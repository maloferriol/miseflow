import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

// Names carry a stamp, so a rerun never exact-matches an earlier run's Recipe (Q10).
const s = String(Date.now());
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

// Seeds the same way recipe.spec.ts does (idempotent).
test.beforeAll(() => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
});

// Soft-deletes the Recipes this run made. Local stack only.
test.afterAll(async () => {
  await sql`update recipes set deleted_at = now() where name like ${`% ${s}`} and deleted_at is null`;
  await sql.end();
});

async function newRecipe(page: Page, name: string) {
  await page.getByRole("button", { name: "Recipes" }).click();
  await page.getByLabel("Recipe name").fill(name);
  await page.getByRole("button", { name: "Create Recipe" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return page.url();
}

async function addStep(page: Page, text: string) {
  await page.getByRole("button", { name: "Add Step" }).click();
  await page.getByLabel("Step text").fill(text);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

test("makes Chicken stock with Create sub-recipe from Velouté, uses it again from Beurre blanc, extracts Pastry from Tarte tatin, and keeps all three links after a reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  const stockChip = new RegExp(`^chicken stock ${s} .* · sub-recipe`, "i");

  // Velouté: nothing matches the name, so the Link choice offers Create sub-recipe.
  const veloute = await newRecipe(page, `Velouté ${s}`);
  await addStep(page, `Simmer @chicken stock ${s}{1.5%L}`);
  const link = page.getByRole("group", { name: `Link ‘chicken stock ${s}’` });
  await expect(link.getByLabel("Name for the sub-recipe")).toHaveValue(`Chicken stock ${s}`);
  await link.getByRole("button", { name: "Create sub-recipe" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: stockChip })).toBeVisible();

  // Beurre blanc: the name matches one Recipe exactly, so it links on its own.
  const beurreBlanc = await newRecipe(page, `Beurre blanc ${s}`);
  await addStep(page, `Reduce @chicken stock ${s}{200%ml}`);
  await expect(page.getByRole("button", { name: stockChip })).toBeVisible();

  // Tarte tatin: extract its first two Steps as Pastry.
  const tarteTatin = await newRecipe(page, `Tarte tatin ${s}`);
  const steps = page.getByRole("list", { name: "Steps" }).locator(":scope > li");
  for (const [index, text] of ["Make the dough", "Rest the dough", "Bake"].entries()) {
    await addStep(page, text);
    await expect(steps).toHaveCount(index + 1);
  }
  const tarteId = new URL(tarteTatin).searchParams.get("recipe")!;
  const extracted = (
    await sql`select id from steps where recipe_id = ${tarteId} and deleted_at is null
      order by position collate "C", id limit 2`
  ).map((r) => r.id as string);
  await page.getByLabel("Select Step 1").check();
  await page.getByLabel("Select Step 2").check();
  const extract = page.getByRole("group", { name: "Extract to sub-recipe" });
  await extract.getByLabel("Name for the sub-recipe").fill(`Pastry ${s}`);
  await extract.getByRole("button", { name: "Extract to sub-recipe" }).click();
  await expect(steps).toHaveCount(2);

  for (const url of [veloute, beurreBlanc]) {
    await page.goto(url);
    await page.reload();
    await expect(page.getByRole("button", { name: stockChip })).toBeVisible();
  }
  await page.goto(tarteTatin);
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(`^Pastry ${s} 1 · sub-recipe`) })).toBeVisible();

  // Chicken stock is used without a yield.
  const [stock] = await sql`select id from recipes where name = ${`Chicken stock ${s}`}`;
  await page.goto(`/?view=recipe&recipe=${stock!.id}`);
  await expect(page.getByText("needs a yield")).toBeVisible();

  // The two Steps moved with their ids, and each Recipe's latest Revision is stored.
  const moved = await sql`select s.recipe_id, r.name from steps s join recipes r on r.id = s.recipe_id
    where s.id in ${sql(extracted)}`;
  expect(moved.map((r) => r.name)).toEqual([`Pastry ${s}`, `Pastry ${s}`]);
  const revisions = await sql`select r.name, r.latest_revision, max(v.number) as max
    from recipes r join recipe_revisions v on v.recipe_id = r.id
    where r.name like ${`% ${s}`} and r.deleted_at is null group by r.id`;
  expect(revisions).toHaveLength(5);
  for (const row of revisions) expect(row.max).toBe(row.latest_revision);
});
