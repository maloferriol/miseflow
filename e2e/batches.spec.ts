import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../shared/test/walkthrough.ts";

// The walkthrough with its Chicken stock and Beurre blanc sub-recipes, its Service and Availability,
// built through POST /mutate. Overwrites the test user's Availability.
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
  w = await buildWalkthrough(run, s, { stock: true });
  await setWalkthroughAvailability(run);
  await run("createService", { serviceId, menuId: w.menuId, date: SERVICE_DATE, time: SERVICE_TIME });
});

// Soft-deletes the Service, its Batches, the Menu and the Recipes this run made. Local stack only.
test.afterAll(async () => {
  if (w) {
    await sql`update batches set deleted_at = now() where service_id = ${serviceId} and deleted_at is null`;
    await sql`update services set deleted_at = now() where id = ${serviceId}`;
    await sql`update menus set deleted_at = now() where id = ${w.menuId}`;
    await sql`update recipes set deleted_at = now() where id in ${sql(Object.values(w.recipes) as string[])}`;
  }
  await sql.end();
});

test("shows the stock Batch's label on the Menu and its Tasks on Thursday in the Plan", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  const label = `Chicken stock ${s} ×1.5 · for: Velouté ${s}, Beurre blanc ${s}`;
  await page.goto(`/?menu=${w.menuId}`);
  await expect(page.getByRole("list", { name: "Batches" })).toContainText(label);

  await page.getByRole("link", { name: "Open Plan" }).click();
  const thursday = page.getByRole("list", { name: "Thursday 29 October" });
  await expect(thursday).toContainText(label);
  for (const step of ["Roast the bones", "Simmer the stock", "Strain the stock"]) await expect(thursday).toContainText(step);
});
