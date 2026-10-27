import {
  fromTimeColumn,
  menus,
  recipes,
  services,
  stepEvents,
  zonedMinute,
} from "@miseflow/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../../shared/test/walkthrough.ts";
import { db, getToken, testApp } from "./helpers.ts";

type App = ReturnType<typeof testApp>;

async function send(method: "GET" | "POST", path: string, body?: unknown, app: App = testApp()) {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const post = (id: string, name: string, args: Record<string, unknown>, app?: App) =>
  send("POST", "/mutate", { id, name, args }, app);

async function ok(name: string, args: Record<string, unknown>) {
  const res = await post(crypto.randomUUID(), name, args);
  expect(res.status, await res.clone().text()).toBe(200);
}

async function readPlan(app?: App) {
  const res = await send("GET", `/services/${serviceId}/plan`, undefined, app);
  expect(res.status).toBe(200);
  return (await res.json()).plan;
}

type Task = { key: string; start: string; steps: { id: string }[]; behind: unknown };
const taskOf = (plan: { days: { date: string; tasks: Task[] }[] }, stepId: string) =>
  plan.days
    .flatMap((d) => d.tasks.map((t) => ({ ...t, date: d.date })))
    .find((t) => t.steps[0]!.id === stepId)!;

const eventsOf = (stepId: string) =>
  db
    .select({ id: stepEvents.id, at: stepEvents.at })
    .from(stepEvents)
    .where(and(eq(stepEvents.serviceId, serviceId), eq(stepEvents.stepId, stepId)));

// What this file made, soft-deleted afterwards; the Step events stay (append-only) on the
// soft-deleted Service. Overwrites the test user's Availability.
const serviceId = crypto.randomUUID();
const s = crypto.randomUUID().slice(0, 8);
const outside = crypto.randomUUID();
let w: Walkthrough;
afterAll(async () => {
  if (!w) return;
  await db
    .update(services)
    .set({ deletedAt: sql`now()` })
    .where(inArray(services.id, [serviceId]));
  await db
    .update(menus)
    .set({ deletedAt: sql`now()` })
    .where(inArray(menus.id, [w.menuId]));
  await db
    .update(recipes)
    .set({ deletedAt: sql`now()` })
    .where(inArray(recipes.id, [...Object.values(w.recipes), outside] as string[]));
});

beforeAll(async () => {
  w = await buildWalkthrough(ok, s);
  await setWalkthroughAvailability(ok);
  await ok("createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
});

const veloute = () => ({ kind: "dish", dishId: w.dishes.veloute });

describe("tickStep through POST /mutate", () => {
  it("AC1: two mutation ids, two rows; a replay adds none; a reused eventId is a 409", async () => {
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
    const firstArgs = {
      eventId: crypto.randomUUID(),
      serviceId,
      owner: veloute(),
      stepId: w.steps.V1,
    };
    expect((await post(first, "tickStep", firstArgs)).status).toBe(200);
    expect(
      (await post(second, "tickStep", { ...firstArgs, eventId: crypto.randomUUID() })).status,
    ).toBe(200);
    expect(await eventsOf(w.steps.V1)).toHaveLength(2);

    expect((await post(first, "tickStep", firstArgs)).status).toBe(200);
    expect(await eventsOf(w.steps.V1)).toHaveLength(2);
    expect((await post(crypto.randomUUID(), "tickStep", firstArgs)).status).toBe(409);
    expect(await eventsOf(w.steps.V1)).toHaveLength(2);
  });

  it("stamps the event with the app's clock", async () => {
    const clock = new Date("2031-03-04T05:06:07.089Z");
    const res = await post(
      crypto.randomUUID(),
      "tickStep",
      { eventId: crypto.randomUUID(), serviceId, owner: veloute(), stepId: w.steps.V3 },
      testApp({ now: () => clock }),
    );
    expect(res.status).toBe(200);
    expect((await eventsOf(w.steps.V3)).map((e) => e.at)).toEqual([clock]);
  });

  it("answers 404 for a Step of a Recipe that isn't on the Menu", async () => {
    const stepId = crypto.randomUUID();
    await ok("createRecipe", {
      recipeId: outside,
      revisionId: crypto.randomUUID(),
      name: `Not on the Menu ${s}`,
    });
    await ok("addStep", {
      recipeId: outside,
      stepId,
      revisionId: crypto.randomUUID(),
      body: [{ type: "text", text: "Stir" }],
      lines: [],
    });
    const res = await post(crypto.randomUUID(), "tickStep", {
      eventId: crypto.randomUUID(),
      serviceId,
      owner: veloute(),
      stepId,
    });
    expect(res.status).toBe(404);
    expect(await eventsOf(stepId)).toEqual([]);
  });
});

describe("Behind on GET /services/:id/plan", () => {
  it("AC3: the Plan read marks D2 behind and lists what it holds up", async () => {
    const d2 = taskOf(await readPlan(), w.steps.D2);
    // Score and season: 10 minutes of active time. Five minutes past its due time:
    const now = new Date(
      (zonedMinute(d2.date, fromTimeColumn(d2.start), "Europe/Paris") + 10 + 5) * 60_000,
    );
    const plan = await readPlan(testApp({ now: () => now }));
    const duck = `Duck breast with beurre blanc ${s}`;
    expect(taskOf(plan, w.steps.D2).behind).toEqual({
      dueAt: "17:30",
      dueDate: SERVICE_DATE,
      holdsUp: [
        { key: `dish:${w.dishes.duck}:${w.steps.D3}`, label: `${duck} · Sear the duck` },
        { key: `dish:${w.dishes.duck}:${w.steps.D4}`, label: `${duck} · Make the beurre blanc` },
      ],
    });
    expect(taskOf(plan, w.steps.T3).behind).toBeNull();
    expect(plan.timeZone).toBe("Europe/Paris");
    expect(plan.asOf).toBe("Sat 31 Oct 17:35");
  });
});
