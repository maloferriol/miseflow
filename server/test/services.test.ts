import { getMutator, menus, recipes, services } from "@miseflow/shared";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
  type Walkthrough,
} from "../../shared/test/walkthrough.ts";
import { db, FIXED_NOW, getToken, testApp } from "./helpers.ts";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

async function send(method: "GET" | "POST", path: string, body?: unknown) {
  return testApp().request(path, {
    method,
    headers: { Authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const mutate = (name: string, args: Record<string, unknown>) =>
  send("POST", "/mutate", { id: crypto.randomUUID(), name, args });

async function ok(name: string, args: Record<string, unknown>) {
  const res = await mutate(name, args);
  expect(res.status, await res.clone().text()).toBe(200);
}

async function readPlan(serviceId: string) {
  const res = await send("GET", `/services/${serviceId}/plan`);
  expect(res.status).toBe(200);
  return (await res.json()).plan;
}

type Task = { steps: { id: string }[]; start: string; approximate: boolean };
const taskOf = (plan: { days: { tasks: Task[] }[] }, stepId: string) =>
  plan.days.flatMap((d) => d.tasks).find((t) => t.steps[0]!.id === stepId);

// What this file made, soft-deleted afterwards (D12). Overwrites the test user's Availability.
const made = { menus: [] as string[], services: [] as string[], recipes: [] as string[] };
afterAll(async () => {
  if (made.services.length)
    await db
      .update(services)
      .set({ deletedAt: sql`now()` })
      .where(inArray(services.id, made.services));
  if (made.menus.length)
    await db
      .update(menus)
      .set({ deletedAt: sql`now()` })
      .where(inArray(menus.id, made.menus));
  if (made.recipes.length)
    await db
      .update(recipes)
      .set({ deletedAt: sql`now()` })
      .where(inArray(recipes.id, made.recipes));
});

let w: Walkthrough;
const serviceId = crypto.randomUUID();

beforeAll(async () => {
  w = await buildWalkthrough(ok, crypto.randomUUID().slice(0, 8));
  made.menus.push(w.menuId);
  made.recipes.push(...Object.values(w.recipes));
  await setWalkthroughAvailability(ok);
  await ok("createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
  made.services.push(serviceId);
});

describe("Services and the Plan read", () => {
  it("answers 409 CONFLICT to a second createService for the Menu", async () => {
    const res = await mutate("createService", {
      serviceId: crypto.randomUUID(),
      menuId: w.menuId,
      date: SERVICE_DATE,
      time: null,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONFLICT");
  });

  it("reads the Plan by day, Thursday to Saturday, with the beurre blanc ≈", async () => {
    const plan = await readPlan(serviceId);
    expect(plan.service).toMatchObject({
      id: serviceId,
      menuId: w.menuId,
      date: SERVICE_DATE,
      time: "19:30",
      timeIsDefault: false,
    });
    expect(plan.days.map((d: { date: string }) => d.date)).toEqual([
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(taskOf(plan, w.steps.D4)).toMatchObject({ approximate: true });
    expect((await (await send("GET", `/menus/${w.menuId}`)).json()).menu.service).toEqual({
      id: serviceId,
      date: SERVICE_DATE,
      time: SERVICE_TIME,
    });
  });

  it("setStepTimes then the Plan read shows the re-fitted Plan", async () => {
    expect(taskOf(await readPlan(serviceId), w.steps.V1)!.start).toBe("17:30");
    await ok("setStepTimes", {
      stepId: w.steps.V1,
      revisionId: crypto.randomUUID(),
      activeMinutes: 15,
      passiveMinutes: null,
    });
    expect(taskOf(await readPlan(serviceId), w.steps.V1)!.start).toBe("17:25");
  });

  it("lists the pastry as Unplaced with its sentence after Friday is shortened", async () => {
    await ok("setAvailabilityOverride", {
      overrideId: crypto.randomUUID(),
      date: "2026-10-30",
      availability: { kind: "hours", start: h(19, 35), end: h(21) },
    });
    const plan = await readPlan(serviceId);
    expect(plan.unplaced).toEqual([
      expect.objectContaining({
        steps: [{ id: w.steps.T1, text: "Make the pastry" }],
        kind: "NoAvailability",
        sentence: "No Cook has 20 free minutes between Fri 00:00 and Fri 19:50",
      }),
    ]);
  });

  it("POST /mutate pinTask then GET plan shows the Task pinned at its new start", async () => {
    const owner = { kind: "dish", dishId: w.dishes.veloute };
    // Sat 31 Oct 16:00 in Paris (UTC+1), on the 5-minute grid.
    const start = Date.UTC(2026, 9, 31, 15, 0) / 60_000;
    const offGrid = await mutate("pinTask", {
      serviceId,
      owner,
      firstStepId: w.steps.V1,
      start: start + 1,
    });
    expect(offGrid.status).toBe(400);
    expect((await offGrid.json()).error.code).toBe("INVALID_ARGS");
    expect(taskOf(await readPlan(serviceId), w.steps.V1)).toMatchObject({ pinned: false });

    await ok("pinTask", { serviceId, owner, firstStepId: w.steps.V1, start });
    const plan = await readPlan(serviceId);
    expect(taskOf(plan, w.steps.V1)).toMatchObject({
      start: "16:00",
      startMinute: start,
      pinned: true,
    });
    expect(plan.model.previous).toContainEqual(
      expect.objectContaining({
        key: `dish:${w.dishes.veloute}:${w.steps.V1}`,
        start,
        pinned: true,
      }),
    );
  });

  it("POST /mutate giveCookMoreTime then GET plan shows the pastry placed, with no Plan trouble", async () => {
    // Its own state: Friday shortened so the pastry is Unplaced (replaces the date's live override, so it runs alone too).
    await ok("setAvailabilityOverride", {
      overrideId: crypto.randomUUID(),
      date: "2026-10-30",
      availability: { kind: "hours", start: h(19, 35), end: h(21) },
    });
    const before = await readPlan(serviceId);
    expect(before.unplaced).toEqual([
      expect.objectContaining({
        steps: [expect.objectContaining({ id: w.steps.T1 })],
        moreTime: true,
        blockingPin: null,
      }),
    ]);
    const starts = new Map(
      before.days
        .flatMap((d: { tasks: { key: string; startMinute: number }[] }) => d.tasks)
        .map((t: { key: string; startMinute: number }) => [t.key, t.startMinute]),
    );

    await ok("giveCookMoreTime", {
      serviceId,
      owner: { kind: "dish", dishId: w.dishes.tarte },
      firstStepId: w.steps.T1,
      overrideId: crypto.randomUUID(),
    });
    const plan = await readPlan(serviceId);
    expect(plan.unplaced).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(taskOf(plan, w.steps.T1)).toMatchObject({ start: "19:30" });
    const after = new Map(
      plan.days
        .flatMap((d: { tasks: { key: string; startMinute: number }[] }) => d.tasks)
        .map((t: { key: string; startMinute: number }) => [t.key, t.startMinute]),
    );
    for (const [key, start] of starts) expect(after.get(key)).toBe(start);
  });

  it("answers 404 for another owner's Service", async () => {
    const other = { ownerId: crypto.randomUUID(), timeZone: "Europe/Paris", now: () => FIXED_NOW };
    const [menuId, theirs] = [crypto.randomUUID(), crypto.randomUUID()];
    const [createMenu, createService] = [getMutator("createMenu")!, getMutator("createService")!];
    await db.transaction(async (tx) => {
      await createMenu.run(
        tx,
        createMenu.args.parse({ menuId, name: "Not yours", guestCount: 2 }),
        other,
      );
      await createService.run(
        tx,
        createService.args.parse({ serviceId: theirs, menuId, date: SERVICE_DATE, time: null }),
        other,
      );
    });
    made.menus.push(menuId);
    made.services.push(theirs);
    expect((await send("GET", `/services/${theirs}/plan`)).status).toBe(404);
    expect((await send("GET", "/services/not-a-uuid/plan")).status).toBe(404);
  });
});
