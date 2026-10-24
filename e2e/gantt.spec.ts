import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { zonedMinute } from "../shared/src/plan/time.ts";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../shared/test/walkthrough.ts";

// The Plan's Gantt chart (#89) on the walkthrough with its Chicken stock and Beurre blanc, its
// Service and Availability, built through POST /mutate. Overwrites the test user's Availability.
// The tests run in order on one Service: each drag pins Roast the bones somewhere new.
test.describe.configure({ mode: "serial" });

const s = String(Date.now());
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const serviceId = crypto.randomUUID();
const timeZone = "Europe/Paris";
const at = (date: string, hours: number, minutes = 0) => zonedMinute(date, hours * 60 + minutes, timeZone);
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

async function openPlan(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.goto(`/?view=plan&service=${serviceId}`);
  const gantt = page.getByRole("region", { name: "Gantt chart" });
  await expect(gantt).toBeVisible();
  return gantt;
}

// Drags `bar` so it starts at `target` (a Minute): the date band holding `target` gives its x, and
// the bar is grabbed 2 px in from its left edge, where its start is.
async function dragTo(page: Page, gantt: Locator, bar: Locator, target: number) {
  await bar.scrollIntoViewIfNeeded();
  const bands = await gantt.locator("[data-band]").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return { from: Number(el.getAttribute("data-from")), to: Number(el.getAttribute("data-to")), x: box.x, width: box.width };
    }),
  );
  const band = bands.find((b) => b.from <= target && target <= b.to);
  if (!band) throw new Error(`No date band holds ${target}`);
  const x = band.x + ((target - band.from) / (band.to - band.from)) * band.width;
  const box = (await bar.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y, { steps: 12 });
  await page.mouse.up();
}

// Every bar's start by Task key (copies of one Task must agree).
async function starts(gantt: Locator) {
  const bars = await gantt.locator("[data-key]").evaluateAll((els) => els.map((el) => [el.getAttribute("data-key")!, el.getAttribute("data-start")!]));
  const out: Record<string, string> = {};
  for (const [key, start] of bars) {
    if (key in out && out[key] !== start) throw new Error(`Copies of ${key} disagree: ${out[key]} and ${start}`);
    out[key] = start!;
  }
  return out;
}

// Holds every POST /api/mutate until `release` is called.
async function holdMutations(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/mutate", async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

test("AC2 and AC3: the stock shows under the Velouté and, greyed, under the Beurre blanc; dragging the ghost moves both; collapsing the Velouté folds it in", async ({ page }) => {
  const gantt = await openPlan(page);
  const stock = `Chicken stock ${s}`;
  const roast = gantt.getByRole("button", { name: /Roast the bones/ });
  await expect(roast).toHaveCount(2);
  const ghost = roast.and(gantt.locator('[data-ghost="true"]'));
  await expect(ghost).toHaveCount(1);
  await expect(ghost).toHaveCSS("opacity", "0.4");
  await expect(gantt.getByRole("group", { name: `${stock} (also shown above)`, exact: true }).getByRole("button", { name: /Roast the bones/ })).toHaveCount(1);

  // Dragging the ghost copy to Thursday 18:00 moves and pins both copies.
  const thursday18 = at("2026-10-29", 18);
  await dragTo(page, gantt, ghost, thursday18);
  for (const bar of await roast.all()) {
    await expect(bar).toHaveAttribute("data-start", String(thursday18));
    await expect(bar).toHaveAttribute("data-pinned", "true");
  }

  // Collapse the Velouté: its stock lane goes and the stock's bars fold into the Velouté's lane.
  const veloute = gantt.getByRole("group", { name: `Velouté ${s}`, exact: true });
  await expect(gantt.getByRole("group", { name: stock, exact: true })).toHaveCount(1);
  await expect(veloute.getByRole("button", { name: /Roast the bones/ })).toHaveCount(0);
  await gantt.getByRole("button", { name: `Collapse Velouté ${s}` }).click();
  await expect(gantt.getByRole("group", { name: stock, exact: true })).toHaveCount(0);
  for (const step of ["Roast the bones", "Simmer the stock", "Strain the stock"])
    await expect(veloute.getByRole("button", { name: new RegExp(step) })).toHaveCount(1);
  await gantt.getByRole("button", { name: `Expand Velouté ${s}` }).click();
  await expect(gantt.getByRole("group", { name: stock, exact: true })).toHaveCount(1);
  await expect(veloute.getByRole("button", { name: /Roast the bones/ })).toHaveCount(0);
});

test("AC4: dragging Roast the bones to Wednesday 18:03 snaps to 18:05, pins it and re-fits the rest before the server answers; after reload it is still there", async ({ page }) => {
  const gantt = await openPlan(page);
  const roast = gantt.getByRole("button", { name: /Roast the bones/ }).and(gantt.locator('[data-ghost="false"]'));
  const wednesday1805 = at("2026-10-28", 18, 5);
  const release = await holdMutations(page);
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/mutate"));

  // 18:03 is off the grid: it rounds to the nearest 5 minutes.
  await dragTo(page, gantt, roast, at("2026-10-28", 18, 3));
  await expect(roast).toHaveAttribute("data-start", String(wednesday1805));
  await expect(roast).toHaveAttribute("data-pinned", "true");
  const optimistic = await starts(gantt);

  release();
  expect((await answered).status()).toBe(200);
  await page.reload();
  await expect(roast).toHaveAttribute("data-start", String(wednesday1805));
  await expect(roast).toHaveAttribute("data-pinned", "true");
  expect(await starts(gantt)).toEqual(optimistic);

  // A pin that moves another Task: Blend and season (V3, Sat 18:50) to 18:40, over Make the beurre
  // blanc (D4, 18:40), which the browser moves to 18:50 before the server answers (as pins.test.ts).
  const v3 = gantt.getByRole("button", { name: /Blend and season/ });
  const d4 = gantt.getByRole("button", { name: /Make the beurre blanc/ });
  await expect(v3).toHaveAttribute("data-start", String(at(SERVICE_DATE, 18, 50)));
  await expect(d4).toHaveAttribute("data-start", String(at(SERVICE_DATE, 18, 40)));
  const releaseV3 = await holdMutations(page);
  const answeredV3 = page.waitForResponse((r) => r.url().endsWith("/api/mutate"));
  await dragTo(page, gantt, v3, at(SERVICE_DATE, 18, 40));
  await expect(v3).toHaveAttribute("data-start", String(at(SERVICE_DATE, 18, 40)));
  await expect(d4).toHaveAttribute("data-start", String(at(SERVICE_DATE, 18, 50)));
  const refitted = await starts(gantt);

  releaseV3();
  expect((await answeredV3).status()).toBe(200);
  await page.reload();
  await expect(d4).toHaveAttribute("data-start", String(at(SERVICE_DATE, 18, 50)));
  await expect(v3).toHaveAttribute("data-pinned", "true");
  expect(await starts(gantt)).toEqual(refitted);
});

test("AC5: two quick drags leave the Plan matching the second, never showing the first's start again", async ({ page }) => {
  const gantt = await openPlan(page);
  const roast = gantt.getByRole("button", { name: /Roast the bones/ }).and(gantt.locator('[data-ghost="false"]'));
  const key = (await roast.getAttribute("data-key"))!;
  const [first, second] = [at("2026-10-28", 19), at("2026-10-28", 20)];
  const release = await holdMutations(page);
  let answers = 0;
  page.on("response", (r) => {
    if (r.url().endsWith("/api/mutate")) answers++;
  });

  await dragTo(page, gantt, roast, first);
  await expect(roast).toHaveAttribute("data-start", String(first));
  await dragTo(page, gantt, roast, second);
  await expect(roast).toHaveAttribute("data-start", String(second));

  // From here on, record every start any copy of the Task shows.
  await page.evaluate((key) => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const record = () => document.querySelectorAll(`[data-key="${key}"]`).forEach((el) => seen.push(el.getAttribute("data-start")!));
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-start"] });
    record();
  }, key);
  release();
  await expect.poll(() => answers).toBe(2);
  // The re-read after the last answer has landed.
  await page.waitForLoadState("networkidle");
  await expect(roast).toHaveAttribute("data-start", String(second));
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.length).toBeGreaterThan(0);
  expect(new Set(seen)).toEqual(new Set([String(second)]));

  await page.reload();
  await expect(roast).toHaveAttribute("data-start", String(second));
  await expect(roast).toHaveAttribute("data-pinned", "true");
});
