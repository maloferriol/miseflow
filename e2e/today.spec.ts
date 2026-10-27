import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../shared/test/walkthrough.ts";

// The walkthrough with its stock (ADR 0004), its Service and Availability, built through POST /mutate.
// Overwrites the test user's Availability. The tick below is stored at the server's real time, so
// once the real date is past the Plan's Thursday it may move what follows; nothing here asserts
// placements after the tick.
const s = String(Date.now());
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const serviceId = crypto.randomUUID();
let w: Walkthrough;

type Task = {
  start: string;
  end: string;
  endDate: string;
  dish: { name: string } | null;
  batch: { label: string } | null;
  steps: { text: string }[];
};
let days: { date: string; tasks: Task[] }[];

test.beforeAll(async ({ request }) => {
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  const token = execFileSync("npm", ["run", "-s", "token", "-w", "server"], {
    encoding: "utf8",
  }).trim();
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
  const res = await request.get(`http://localhost:8787/services/${serviceId}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  days = (await res.json()).plan.days;
});

// Soft-deletes the Service, its Batches, the Menu and the Recipes this run made. Local stack only.
// The Step events stay (append-only) on the soft-deleted Service.
test.afterAll(async () => {
  if (w) {
    await sql`update batches set deleted_at = now() where service_id = ${serviceId} and deleted_at is null`;
    await sql`update services set deleted_at = now() where id = ${serviceId}`;
    await sql`update menus set deleted_at = now() where id = ${w.menuId}`;
    await sql`update recipes set deleted_at = now() where id in ${sql(Object.values(w.recipes) as string[])}`;
  }
  await sql.end();
});

// "Thursday 29 October", as the web app heads a kitchen-zone date.
const heading = (date: string) => {
  const at = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    at.toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}`;
};
const shortDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" });
// "18:20–18:40 · Chicken stock ×1.5 · for: … · Roast the bones", as the Plan screen's line.
const line = (task: Task, date: string) =>
  `${task.start}–${task.endDate === date ? task.end : `${task.end} (${shortDay(task.endDate)})`} · ${task.batch?.label ?? task.dish?.name} · ${task.steps
    .map((step) => step.text)
    .join(", ")}`;

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("AC4: a tab per day with Tasks, Tasks in Plan time order", async ({ page }) => {
  await signIn(page);
  await page.goto(`/?view=today&service=${serviceId}`);
  await page.getByRole("tab", { name: "Thursday 29 October" }).click();
  const tabs = page.getByRole("tablist", { name: "Prep days" }).getByRole("tab");
  await expect(tabs).toHaveText(days.map((d) => heading(d.date)));

  const saturday = days.find((d) => d.date === SERVICE_DATE)!;
  await page.getByRole("tab", { name: heading(saturday.date) }).click();
  const items = page
    .getByRole("tabpanel")
    .getByRole("list", { name: heading(saturday.date) })
    .getByRole("listitem");
  await expect(items).toHaveCount(saturday.tasks.length);
  const lines = saturday.tasks.map((t) => line(t, saturday.date));
  const texts = await items.allInnerTexts();
  expect(texts.map((text, i) => text.slice(0, lines[i]!.length))).toEqual(lines);
});

test("AC6: a tick on Thursday's tab is still there after a reload", async ({ page }) => {
  const thursday = days.find((d) => d.date === "2026-10-29")!;
  const stepText = thursday.tasks[0]!.steps[0]!.text;
  await signIn(page);
  await page.goto(`/?view=today&service=${serviceId}`);
  await page.getByRole("tab", { name: "Thursday 29 October" }).click();
  const box = page.getByRole("checkbox", { name: stepText });
  await expect(box).not.toBeChecked();
  const applied = page.waitForResponse(
    (r) => r.url().endsWith("/api/mutate") && r.request().method() === "POST",
  );
  await box.check();
  expect((await applied).status()).toBe(200);

  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Thursday 29 October", selected: true }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: stepText })).toBeChecked();
});

test("AC5: print media shows one section per day, a tick box per Step and Printed at, with no app chrome", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/?view=today&service=${serviceId}`);
  await expect(page.getByRole("tablist", { name: "Prep days" })).toBeVisible();
  // In the past on purpose, so supabase-js never takes the session as expired.
  await page.clock.setFixedTime(new Date("2026-10-01T16:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });

  await expect(page.getByRole("navigation")).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  await expect(page.getByRole("tablist")).toBeHidden();
  const printed = page.getByRole("region", { name: "Printed Plan" });
  await expect(printed).toBeVisible();
  await expect(printed).toContainText("Printed at Thu 1 Oct 18:00");

  const sections = printed.getByRole("region");
  await expect(sections).toHaveCount(days.length);
  for (const [i, day] of days.entries()) {
    const section = sections.nth(i);
    await expect(section).toHaveAccessibleName(heading(day.date));
    const steps = await section
      .getByRole("list", { name: "Steps" })
      .getByRole("listitem")
      .allInnerTexts();
    expect(steps).toHaveLength(day.tasks.reduce((n, t) => n + t.steps.length, 0));
    for (const step of steps) expect(step.startsWith("☐ ")).toBe(true);
  }
  expect(await sections.nth(1).evaluate((el) => getComputedStyle(el).breakBefore)).toBe("page");
});
