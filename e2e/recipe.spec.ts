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

test("won't save an unmatched name until it is linked: a near match adds an alias, or a new Ingredient is created", async ({
  page,
}) => {
  const name = `E2E link ${Date.now()}`;
  const fresh = `zest${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "Recipes" }).click();
  await page.getByLabel("Recipe name").fill(name);
  await page.getByRole("button", { name: "Create Recipe" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("button", { name: "Add Step" }).click();
  await page.getByLabel("Step text").fill(`Melt @butte{30%g} with @${fresh}{}`);
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();

  // Neither name is exact, so the Step waits for both to be linked.
  await expect(page.getByRole("group", { name: "Link ‘butte’" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: `Link ‘${fresh}’` }),
  ).toBeVisible();
  await expect(save).toBeDisabled();

  await page
    .getByRole("list", { name: "Near matches for butte" })
    .getByRole("button", { name: "Use butter" })
    .click();
  await expect(page.getByRole("group", { name: "Link ‘butte’" })).toBeHidden();
  await expect(save).toBeDisabled();

  await page
    .getByRole("group", { name: `Link ‘${fresh}’` })
    .getByRole("button", { name: "Create Ingredient" })
    .click();
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.getByRole("button", { name: /^butte 30 g/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${fresh}`) }),
  ).toBeVisible();

  const recipeId = new URL(page.url()).searchParams.get("recipe")!;
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  });
  try {
    const lines = await sql`
      select l.wording, i.name as ingredient
      from ingredient_lines l join steps s on s.id = l.step_id
      left join ingredients i on i.id = l.ingredient_id
      where s.recipe_id = ${recipeId} and l.deleted_at is null
      order by l.position collate "C"`;
    expect(lines.map((l) => [l.wording, l.ingredient])).toEqual([
      ["butte", "butter"],
      [fresh, fresh],
    ]);
    const aliases = await sql`
      select a.name from ingredient_aliases a
      join ingredients i on i.id = a.ingredient_id
      join recipes r on r.owner_id = a.owner_id
      where r.id = ${recipeId} and a.deleted_at is null
        and a.name = 'butte' and i.name = 'butter'`;
    expect(aliases).toHaveLength(1);
  } finally {
    // So the next run's "butte" is still only a near match.
    await sql`
      update ingredient_aliases a set deleted_at = now()
      from recipes r
      where r.id = ${recipeId} and a.owner_id = r.owner_id
        and a.name = 'butte' and a.deleted_at is null`;
    // And the Ingredient this run created, so the test user's catalog doesn't grow every run.
    await sql`
      update ingredients i set deleted_at = now()
      from recipes r
      where r.id = ${recipeId} and i.owner_id = r.owner_id
        and i.name = ${fresh} and i.deleted_at is null`;
    await sql.end();
  }
});

test("a Save retried after a lost response replays the same mutation: no 409, one Revision per save", async ({
  page,
}) => {
  const name = `E2E retry ${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Recipes" }).click();
  await page.getByLabel("Recipe name").fill(name);
  await page.getByRole("button", { name: "Create Recipe" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // The server applies the first addStep and editStep, but the browser never sees the answer.
  const dropped = new Set<string>();
  await page.route("**/api/mutate", async (route) => {
    const mutation = route.request().postDataJSON() as { name: string };
    if (
      ["addStep", "editStep"].includes(mutation.name) &&
      !dropped.has(mutation.name)
    ) {
      dropped.add(mutation.name);
      await route.fetch();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  const save = page.getByRole("button", { name: "Save", exact: true });

  await page.getByRole("button", { name: "Add Step" }).click();
  await page.getByLabel("Step text").fill("Melt @butter{30%g}");
  await save.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await save.click();
  await expect(page.getByRole("button", { name: "butter 30 g" })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Step text").fill("Melt @butter{40%g}");
  await save.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await save.click();
  await expect(page.getByRole("button", { name: "butter 40 g" })).toBeVisible();
  expect([...dropped]).toEqual(["addStep", "editStep"]);

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
    // createRecipe, addStep, editStep: three Revisions, not five.
    expect(row).toMatchObject({ latest_revision: 3, count: 3 });
    const steps =
      await sql`select id from steps where recipe_id = ${recipeId} and deleted_at is null`;
    expect(steps).toHaveLength(1);
  } finally {
    await sql.end();
  }
});
