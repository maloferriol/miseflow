import { execFileSync } from "node:child_process";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";
import {
  buildWalkthrough,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../shared/test/walkthrough.ts";

// The Unplaced Task quick fixes (#90 AC6): the walkthrough Menu, its Service and Availability are
// built through POST /mutate; Friday is shortened through the Availability screen, as in
// plan.spec.ts. Overwrites the test user's weekly hours (D12).
//
// The walkthrough a week later (Service Sat 7 Nov, Friday 6 Nov 19:00–21:00 as the walkthrough's
// Friday override): the other specs run in parallel on the same user and plan Sat 31 Oct, so
// shortening Fri 30 Oct here would leave their pastry Unplaced (and their Availability saves would
// put ours back). Nothing else plans around Fri 6 Nov.
const SERVICE_DATE = "2026-11-07";
const FRIDAY = "2026-11-06";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const s = String(Date.now());
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const serviceId = crypto.randomUUID();
let w: Walkthrough;
let token: string;

// POST /mutate as the test user, through `request`.
const post =
  (request: APIRequestContext) => async (name: string, args: Record<string, unknown>) => {
    const res = await request.post("http://localhost:8787/mutate", {
      headers: { Authorization: `Bearer ${token}` },
      data: { id: crypto.randomUUID(), name, args },
    });
    expect(res.status(), await res.text()).toBe(200);
  };

test.beforeAll(async ({ request }) => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  token = execFileSync("npm", ["run", "-s", "token", "-w", "server"], { encoding: "utf8" }).trim();
  const run = post(request);
  w = await buildWalkthrough(run, s);
  await setWalkthroughAvailability(run);
  await run("setAvailabilityOverride", {
    overrideId: crypto.randomUUID(),
    date: FRIDAY,
    availability: { kind: "hours", start: h(19), end: h(21) },
  });
  await run("createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
});

// Puts Fri 6 Nov back to the weekly hours, then soft-deletes the Service, the Menu and the
// Recipes this run made. Local stack only.
test.afterAll(async ({ request }) => {
  if (w) {
    await post(request)("setAvailabilityOverride", {
      overrideId: crypto.randomUUID(),
      date: FRIDAY,
      availability: { kind: "weekly" },
    });
    await sql`update services set deleted_at = now() where id = ${serviceId}`;
    await sql`update menus set deleted_at = now() where id = ${w.menuId}`;
    await sql`update recipes set deleted_at = now() where id in ${sql(Object.values(w.recipes))}`;
  }
  await sql.end();
});

const mutated = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith("/api/mutate") && r.request().method() === "POST" && r.ok(),
  );

// Every bar's start by Task key (copies of one Task must agree).
async function starts(gantt: Locator) {
  const bars = await gantt
    .locator("[data-key]")
    .evaluateAll((els) =>
      els.map((el) => [el.getAttribute("data-key")!, el.getAttribute("data-start")!]),
    );
  const out: Record<string, string> = {};
  for (const [key, start] of bars) {
    if (key in out && out[key] !== start)
      throw new Error(`Copies of ${key} disagree: ${out[key]} and ${start}`);
    out[key] = start!;
  }
  return out;
}

test("AC6: Friday shortened leaves the pastry Unplaced with Plan trouble 1; Give the Cook more time brings it back and moves nothing else", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  // The walkthrough's step 5: Friday 19:35–21:00 through the Availability screen.
  await page.goto(`/?menu=${w.menuId}`);
  await page.getByRole("button", { name: "Availability" }).click();
  await page.getByLabel("Date", { exact: true }).fill(FRIDAY);
  await page.getByLabel("From").last().fill("19:35");
  await page.getByLabel("To").last().fill("21:00");
  await Promise.all([
    mutated(page),
    page.getByRole("button", { name: "Save override", exact: true }).click(),
  ]);
  await expect(page.getByRole("list", { name: "Date overrides" })).toContainText(
    `${FRIDAY}: 19:35–21:00`,
  );

  await page.goto(`/?view=plan&service=${serviceId}`);
  const gantt = page.getByRole("region", { name: "Gantt chart" });
  await expect(gantt).toBeVisible();
  const unplaced = page.getByRole("list", { name: "Unplaced Tasks" });
  const pastry = unplaced.getByRole("listitem").filter({ hasText: "Make the pastry" });
  await expect(pastry).toContainText("No Cook has 20 free minutes between Fri 00:00 and Fri 19:50");
  await expect(page.getByRole("status", { name: "Plan trouble: 1" })).toBeVisible();
  const pastryKey = `dish:${w.dishes.tarte}:${w.steps.T1}`;
  const pastryBar = gantt.locator(`[data-key="${pastryKey}"]`);
  await expect(pastryBar).toHaveCount(0);
  const before = await starts(gantt);
  expect(Object.keys(before)).toHaveLength(9);

  await Promise.all([
    mutated(page),
    pastry.getByRole("button", { name: "Give the Cook more time" }).click(),
  ]);
  await expect(pastryBar).toHaveCount(1);
  await expect(page.getByRole("status", { name: /Plan trouble/ })).toHaveCount(0);
  await expect(page.getByText("Every Task is planned")).toBeVisible();
  const after = await starts(gantt);
  expect(Object.fromEntries(Object.entries(after).filter(([key]) => key !== pastryKey))).toEqual(
    before,
  );

  await page.reload();
  await expect(pastryBar).toHaveCount(1);
  await expect(page.getByRole("status", { name: /Plan trouble/ })).toHaveCount(0);
  expect(await starts(gantt)).toEqual(after);
});
