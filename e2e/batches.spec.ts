import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../shared/test/walkthrough.ts";
import { createTestUser, deleteTestUser, type TestUser } from "./test-user.ts";

// The walkthrough with its Chicken stock and Beurre blanc sub-recipes, its Service and Availability,
// built through POST /mutate. Sets this spec's own user's Availability.
const s = String(Date.now());
const serviceId = crypto.randomUUID();
let w: Walkthrough;
let user: TestUser;

test.beforeAll(async ({ request }) => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  user = await createTestUser("batches");
  const { token } = user;
  const run = async (name: string, args: Record<string, unknown>) => {
    const res = await request.post("http://localhost:8787/mutate", {
      headers: { Authorization: `Bearer ${token}` },
      data: { id: crypto.randomUUID(), name, args },
    });
    expect(res.status(), await res.text()).toBe(200);
  };
  w = await buildWalkthrough(run, s, { stock: true });
  await setWalkthroughAvailability(run);
  await run("createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
});

// deleteTestUser hard-deletes every row this spec's user owns.
test.afterAll(async () => {
  if (user) await deleteTestUser(user);
});

test("shows the stock Batch's label on the Menu and its Tasks on Thursday in the Plan", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  const label = `Chicken stock ${s} ×1.5 · for: Velouté ${s}, Beurre blanc ${s}`;
  await page.goto(`/?menu=${w.menuId}`);
  await expect(page.getByRole("list", { name: "Batches" })).toContainText(label);

  await page.getByRole("link", { name: "Open Plan" }).click();
  const thursday = page.getByRole("list", { name: "Thursday 29 October" });
  await expect(thursday).toContainText(label);
  for (const step of ["Roast the bones", "Simmer the stock", "Strain the stock"])
    await expect(thursday).toContainText(step);
});
