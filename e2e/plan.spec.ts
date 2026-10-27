import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { buildWalkthrough, type Walkthrough } from "../shared/test/walkthrough.ts";
import { createTestUser, deleteTestUser, type TestUser } from "./test-user.ts";

// The walkthrough Menu is built through POST /mutate; the Service and the Availability through the UI.
// Sets this spec's own user's Availability (D12).
const s = String(Date.now());
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let w: Walkthrough;
let user: TestUser;

test.beforeAll(async ({ request }) => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  user = await createTestUser("plan");
  const { token } = user;
  w = await buildWalkthrough(async (name, args) => {
    const res = await request.post("http://localhost:8787/mutate", {
      headers: { Authorization: `Bearer ${token}` },
      data: { id: crypto.randomUUID(), name, args },
    });
    expect(res.status(), await res.text()).toBe(200);
  }, s);
});

// Soft-deletes the Menu, its Service and the Recipes this run made. Local stack only.
test.afterAll(async () => {
  if (w) {
    await sql`update services set deleted_at = now() where menu_id = ${w.menuId} and deleted_at is null`;
    await sql`update menus set deleted_at = now() where id = ${w.menuId}`;
    await sql`update recipes set deleted_at = now() where id in ${sql(Object.values(w.recipes))}`;
  }
  if (user) await deleteTestUser(user);
  await sql.end();
});

// Clicks a save button and waits for its mutation to be applied.
async function save(page: Page, name: string) {
  const applied = page.waitForResponse(
    (r) => r.url().endsWith("/api/mutate") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name, exact: true }).click();
  expect((await applied).status()).toBe(200);
}

test("adds the Service and Availability, opens the Plan with Tasks Thursday to Saturday, and sees the same Plan after a reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.goto(`/?menu=${w.menuId}`);
  await page.getByLabel("Service date").fill("2026-10-31");
  await page.getByLabel("Service time (optional)").fill("19:30");
  await save(page, "Add Service");
  await expect(page.getByRole("link", { name: "Open Plan" })).toBeVisible();

  await page.getByRole("button", { name: "Availability" }).click();
  const week: Record<string, [string, string] | null> = {
    Sunday: null,
    Monday: null,
    Tuesday: null,
    Wednesday: null,
    Thursday: ["18:00", "22:00"],
    Friday: ["18:00", "22:00"],
    Saturday: ["09:00", "19:00"],
  };
  for (const [day, hours] of Object.entries(week)) {
    const group = page.getByRole("group", { name: day });
    await group.getByLabel("Available").setChecked(hours !== null);
    if (hours) {
      await group.getByLabel("From").fill(hours[0]);
      await group.getByLabel("To").fill(hours[1]);
    }
  }
  await save(page, "Save week");
  await page.getByLabel("Date", { exact: true }).fill("2026-10-30");
  await page.getByLabel("From").last().fill("19:00");
  await page.getByLabel("To").last().fill("21:00");
  await save(page, "Save override");
  await expect(page.getByRole("list", { name: "Date overrides" })).toContainText(
    "2026-10-30: 19:00–21:00",
  );

  await page.goto(`/?menu=${w.menuId}`);
  await page.getByRole("link", { name: "Open Plan" }).click();
  const plan = page.getByRole("region", { name: "Plan" });
  for (const day of ["Thursday 29 October", "Friday 30 October", "Saturday 31 October"]) {
    await expect(plan.getByRole("heading", { name: day })).toBeVisible();
    await expect(plan.getByRole("list", { name: day }).getByRole("listitem")).not.toHaveCount(0);
  }
  await expect(plan.getByRole("list", { name: "Thursday 29 October" })).toContainText(
    "Dry-brine the duck",
  );
  await expect(plan.getByRole("listitem").filter({ hasText: "≈" })).toHaveCount(1);

  const before = await plan.innerText();
  await page.reload();
  await expect(plan.getByRole("heading", { name: "Saturday 31 October" })).toBeVisible();
  expect(await plan.innerText()).toBe(before);
});
