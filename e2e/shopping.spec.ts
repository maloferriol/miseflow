import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { buildWalkthrough, SERVICE_DATE, SERVICE_TIME, type Walkthrough } from "../shared/test/walkthrough.ts";

// The walkthrough with its Ingredient lines and Pastry (#91), and its Service, built through
// POST /mutate with the seed's Ingredients.
const s = String(Date.now());
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const serviceId = crypto.randomUUID();
let w: Walkthrough;

test.beforeAll(async ({ request }) => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  const token = execFileSync("npm", ["run", "-s", "token", "-w", "server"], { encoding: "utf8" }).trim();
  const run = async (name: string, args: Record<string, unknown>) => {
    const res = await request.post("http://localhost:8787/mutate", {
      headers: { Authorization: `Bearer ${token}` },
      data: { id: crypto.randomUUID(), name, args },
    });
    expect(res.status(), await res.text()).toBe(200);
  };
  const seed = async (name: string) => (await sql`select id from ingredients where owner_id is null and name = ${name}`)[0]!.id as string;
  const shopping = {
    shallot: await seed("shallot"),
    butter: await seed("butter"),
    flour: await seed("all-purpose flour"),
    salt: await seed("salt"),
    apple: await seed("apple"),
    sugar: await seed("sugar"),
  };
  w = await buildWalkthrough(run, s, { shopping });
  await run("createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
});

// Soft-deletes the marks, the Service, its Batches, the Menu and the Recipes this run made. Local stack only.
test.afterAll(async () => {
  if (w) {
    await sql`update shopping_marks set deleted_at = now() where service_id = ${serviceId} and deleted_at is null`;
    await sql`update batches set deleted_at = now() where service_id = ${serviceId} and deleted_at is null`;
    await sql`update services set deleted_at = now() where id = ${serviceId}`;
    await sql`update menus set deleted_at = now() where id = ${w.menuId}`;
    await sql`update recipes set deleted_at = now() where id in ${sql(Object.values(w.recipes) as string[])}`;
  }
  await sql.end();
});

async function openShoppingList(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.goto(`/?menu=${w.menuId}`);
  await page.getByRole("link", { name: "Open Shopping list" }).click();
  await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();
}

test("ticks two rows Got on the walkthrough's Shopping list and keeps them after a reload", async ({ page }) => {
  await openShoppingList(page);
  // Each tick's POST /mutate has answered before the reload, so its mark is committed.
  for (const name of ["butter", "apple"]) {
    const saved = page.waitForResponse((res) => res.url().endsWith("/api/mutate") && res.request().method() === "POST" && res.ok());
    await page.getByRole("checkbox", { name }).check();
    await saved;
    await expect(page.getByRole("checkbox", { name })).toBeChecked();
  }

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "butter" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "apple" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "sugar" })).not.toBeChecked();
});

test("prints the Shopping list's categories, rows, needs and tick boxes without the app chrome", async ({ page }) => {
  await openShoppingList(page);
  await page.emulateMedia({ media: "print" });

  for (const category of ["Produce", "Dairy & eggs", "Dry goods", "Spices"])
    await expect(page.getByRole("heading", { name: category })).toBeVisible();
  const dairy = page.getByRole("list", { name: "Dairy & eggs" });
  await expect(dairy.getByRole("listitem")).toHaveText(["butter 300 g"]);
  await expect(page.getByRole("list", { name: "Spices" }).getByRole("listitem")).toHaveText(["salt a pinch"]);
  await expect(page.getByRole("list", { name: "Produce" }).getByRole("listitem")).toHaveText(["apple 6", "shallot 150 g"]);
  for (const name of ["butter", "apple", "shallot", "all-purpose flour", "sugar", "salt"])
    await expect(page.getByRole("checkbox", { name })).toBeVisible();

  await expect(page.getByRole("heading", { name: "MiseFlow" })).toBeHidden();
  await expect(page.getByRole("navigation")).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
});
