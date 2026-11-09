import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { db, inRollback, underUncommittedChild } from "../../test/db.ts";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
} from "../../test/walkthrough.ts";
import { ensureCook } from "../kitchen/availability.ts";
import { applyMutation } from "../mutators/apply.ts";
import {
  defineMutator,
  getMutator,
  type MutatorContext,
  NotFoundError,
  type Tx,
} from "../mutators/registry.ts";
import { schedule } from "../scheduler/schedule.ts";
import { taskKey } from "../scheduler/types.ts";
import { availabilityWeekly, cooks, dishes, recipes, services, stepEvents } from "../schema.ts";
import { readPlan } from "./read.ts";
import type { ReplanScope } from "./replan.ts";
import { zonedMinute } from "./time.ts";

// The Re-plan module (ADR 0013) through `applyMutation`, with small test mutators that only
// register scopes, against Postgres.

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");
const ownerId: string = crypto.randomUUID();
const timeZone = "Europe/Paris";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const at = (hours: number, minutes = 0) => zonedMinute(SERVICE_DATE, h(hours, minutes), timeZone);

const context = (owner: string) => ({ ownerId: owner, timeZone, now: () => FIXED_NOW });

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await applyMutation(tx, mutator, mutator.args.parse(args), context(owner));
}

// A test mutator that only does what `write` does with the context, applied as any mutation is.
function apply(
  tx: Tx,
  write: (ctx: MutatorContext, tx: Tx) => unknown,
  owner = ownerId,
): Promise<string[]> {
  const probe = defineMutator({
    name: "probe",
    args: z.strictObject({}),
    run: async (tx, _args, ctx) => void (await write(ctx, tx)),
  });
  return applyMutation(tx, probe, {}, context(owner));
}

async function addService(tx: Tx, menuId: string, time: number | null, owner = ownerId) {
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", { serviceId, menuId, date: SERVICE_DATE, time }, owner);
  return serviceId;
}

async function addMenu(tx: Tx, name: string, recipeId: string | null, owner = ownerId) {
  const menuId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  await run(tx, "createMenu", { menuId, name, guestCount: 6 }, owner);
  await run(tx, "addCourse", { courseId, menuId, name: "Main" }, owner);
  if (recipeId)
    await run(tx, "addDish", { dishId: crypto.randomUUID(), courseId, recipeId }, owner);
  return { menuId, courseId };
}

// Three Services: the walkthrough with its sub-recipes (A, at its own time), a Menu with the
// Tarte tatin (B) and a Menu with an empty Course (C), both at the kitchen's default time.
async function kitchen(tx: Tx, owner = ownerId) {
  const as = (name: string, args: Record<string, unknown>) => run(tx, name, args, owner);
  const w = await buildWalkthrough(as, owner.slice(0, 8), { stock: true });
  await setWalkthroughAvailability(as);
  const menuB = await addMenu(tx, "Tarte", w.recipes.tarte, owner);
  const menuC = await addMenu(tx, "Empty", null, owner);
  return {
    w,
    menuB,
    menuC,
    a: await addService(tx, w.menuId, SERVICE_TIME, owner),
    b: await addService(tx, menuB.menuId, null, owner),
    c: await addService(tx, menuC.menuId, null, owner),
  };
}

const livePlacements = async (tx: Tx, serviceId: string) =>
  (await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW)).days.flatMap((d) => d.tasks).length;

describe("Scopes", () => {
  it("each scope kind re-plans the caller's live Services it reaches, once each, in id order", async () => {
    await inRollback(async (tx) => {
      const { w, menuB, a, b, c } = await kitchen(tx);
      // Another owner's Service is never in scope.
      const other = crypto.randomUUID();
      await addService(tx, (await addMenu(tx, "Other", null, other)).menuId, null, other);
      const scopes: ReplanScope[] = [
        { recipeId: w.recipes.veloute },
        { recipeId: w.recipes.tarte },
        // The stock is used only through the Velouté and the Beurre blanc sub-recipe (#87).
        { recipeId: w.recipes.stock! },
        { menuId: menuB.menuId },
        { serviceId: c },
        { allServices: true as const },
        { allServices: true as const, onlyDefaultTime: true },
      ];
      const replanned = [];
      for (const scope of scopes) replanned.push(await apply(tx, (ctx) => ctx.replan.after(scope)));
      expect(replanned).toEqual([
        [a],
        [a, b].sort(),
        [a],
        [b],
        [c],
        [a, b, c].sort(),
        [b, c].sort(),
      ]);
    });
  });

  it("a Service that isn't the caller's live one is NotFound, through after and lock", async () => {
    await inRollback(async (tx) => {
      const { a } = await kitchen(tx);
      const missing = { serviceId: crypto.randomUUID() };
      await expect(apply(tx, (ctx) => ctx.replan.after(missing))).rejects.toThrow(
        new NotFoundError("Service"),
      );
      await expect(apply(tx, (ctx) => ctx.replan.lock(missing))).rejects.toThrow(
        new NotFoundError("Service"),
      );
      await expect(
        apply(tx, (ctx) => ctx.replan.after({ serviceId: a }), crypto.randomUUID()),
      ).rejects.toThrow(new NotFoundError("Service"));
    });
  });

  it("an after scope is turned into Services once the write is done: a Dish the write adds counts", async () => {
    await inRollback(async (tx) => {
      const { w, menuC, a, c } = await kitchen(tx);
      expect(await livePlacements(tx, c)).toBe(0);
      const replanned = await apply(tx, async (ctx, tx) => {
        ctx.replan.after({ recipeId: w.recipes.veloute });
        await tx.insert(dishes).values({
          id: crypto.randomUUID(),
          ownerId,
          courseId: menuC.courseId,
          recipeId: w.recipes.veloute,
          position: "a",
        });
      });
      expect(replanned).toEqual([a, c].sort());
      // The Velouté's three Steps, and the three of the stock it uses, as a Batch.
      expect(await livePlacements(tx, c)).toBe(6);
    });
  });

  it("lock's Services are re-planned at the end too, and lock returns them and the Cook", async () => {
    await inRollback(async (tx) => {
      const { a, b, c } = await kitchen(tx);
      let locked: unknown;
      const replanned = await apply(
        tx,
        async (ctx) =>
          (locked = await ctx.replan.lock(
            { allServices: true, onlyDefaultTime: true },
            { cook: true },
          )),
      );
      expect(locked).toEqual({ serviceIds: [b, c].sort(), cookId: ownerId });
      expect(replanned).toEqual([b, c].sort());
      expect(await apply(tx, (ctx) => ctx.replan.lock({ serviceId: a }))).toEqual([a]);
    });
  });
});

describe("Once per Service", () => {
  // How many times this transaction has read the placements table (each re-plan reads it).
  const placementReads = async (tx: Tx) => {
    const rows: unknown = await tx.execute(
      sql`select coalesce(seq_scan, 0) + coalesce(idx_scan, 0) as n from pg_stat_xact_user_tables where relname = 'task_placements'`,
    );
    const [row] = rows as { n: string }[];
    return Number(row?.n ?? 0);
  };

  it("a Service registered several times, through lock and after, is re-planned once", async () => {
    await inRollback(async (tx) => {
      const { w, a, b } = await kitchen(tx);
      let before = await placementReads(tx);
      expect(await apply(tx, (ctx) => ctx.replan.after({ serviceId: a }))).toEqual([a]);
      const once = (await placementReads(tx)) - before;
      expect(once).toBeGreaterThan(0);

      before = await placementReads(tx);
      const replanned = await apply(tx, async (ctx) => {
        await ctx.replan.lock({ serviceId: a });
        ctx.replan.after({ menuId: w.menuId });
        ctx.replan.after({ recipeId: w.recipes.stock! });
        ctx.replan.after({ serviceId: a });
      });
      expect(replanned).toEqual([a]);
      expect((await placementReads(tx)) - before).toBe(once);
      // Not vacuous: two Services read twice as much.
      before = await placementReads(tx);
      const two = await apply(tx, (ctx) => ctx.replan.after({ recipeId: w.recipes.tarte }));
      expect(two).toEqual([a, b].sort());
      expect((await placementReads(tx)) - before).toBe(2 * once);
    });
  });
});

describe("Options", () => {
  // The walkthrough's Plan after several moves (AC4, CONTEXT Pin: moving a Task pins it): Blend
  // and season (V3) pinned at 18:40 pushes Make the beurre blanc (D4) to 18:50; Sweat the shallots
  // (V1) pinned at Sat 10:00; then V3 unpinned. D4 keeps 18:50 through a normal re-plan.
  async function moved(tx: Tx) {
    const s = crypto.randomUUID().slice(0, 8);
    const w = await buildWalkthrough((name, args) => run(tx, name, args), s);
    await setWalkthroughAvailability((name, args) => run(tx, name, args));
    const serviceId = await addService(tx, w.menuId, SERVICE_TIME);
    const veloute = { kind: "dish" as const, dishId: w.dishes.veloute };
    await run(tx, "pinTask", {
      serviceId,
      owner: veloute,
      firstStepId: w.steps.V3,
      start: at(18, 40),
    });
    await run(tx, "pinTask", { serviceId, owner: veloute, firstStepId: w.steps.V1, start: at(10) });
    await run(tx, "unpinTask", { serviceId, owner: veloute, firstStepId: w.steps.V3 });
    const { model } = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
    const v1 = taskKey(veloute, w.steps.V1);
    const v3 = taskKey(veloute, w.steps.V3);
    const d4 = taskKey({ kind: "dish", dishId: w.dishes.duck }, w.steps.D4);
    // The Plan the scheduler makes when only these previous placements are kept.
    const keeping = (keep: (key: string, pinned: boolean) => boolean) =>
      startsOf(
        schedule({ ...model, previous: model.previous.filter((p) => keep(p.key, p.pinned)) })
          .placements,
      );
    return { serviceId, v1, v3, d4, keeping };
  }
  const startsOf = (placed: { key: string; start: number }[]) =>
    new Map(placed.map((p) => [p.key, p.start]));
  const storedStarts = async (tx: Tx, serviceId: string) =>
    new Map(
      (await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW)).days
        .flatMap((d) => d.tasks)
        .map((t) => [t.key, t.startMinute]),
    );

  it("without options, every Task keeps its previous start", async () => {
    await inRollback(async (tx) => {
      const { serviceId, keeping } = await moved(tx);
      const stored = await storedStarts(tx, serviceId);
      expect(keeping(() => true)).toEqual(stored);
      await apply(tx, (ctx) => ctx.replan.after({ serviceId }));
      expect(await storedStarts(tx, serviceId)).toEqual(stored);
    });
  });

  it("release drops the released Task's previous start, even a pinned one's", async () => {
    await inRollback(async (tx) => {
      const { serviceId, v1, keeping } = await moved(tx);
      const released = keeping((key) => key !== v1);
      expect(released.get(v1)).not.toBe(at(10));
      await apply(tx, (ctx) => ctx.replan.after({ serviceId }, { release: v1 }));
      expect(await storedStarts(tx, serviceId)).toEqual(released);
    });
  });

  it("releases of one Service add up: D4 moves back only when V3 and D4 are both released", async () => {
    await inRollback(async (tx) => {
      const { serviceId, v3, d4, keeping } = await moved(tx);
      const both = keeping((key) => key !== v3 && key !== d4);
      // Not vacuous: each release on its own makes another Plan.
      expect(both).not.toEqual(keeping((key) => key !== v3));
      expect(both).not.toEqual(keeping((key) => key !== d4));
      await apply(tx, (ctx) => {
        ctx.replan.after({ serviceId }, { release: v3 });
        ctx.replan.after({ serviceId }, { release: d4 });
      });
      expect(await storedStarts(tx, serviceId)).toEqual(both);
    });
  });

  it("fromScratch keeps only pinned Tasks, and wins over a normal re-plan of the same Service", async () => {
    await inRollback(async (tx) => {
      const { serviceId, v1, keeping } = await moved(tx);
      const fresh = keeping((_key, pinned) => pinned);
      expect(fresh.get(v1)).toBe(at(10));
      expect(fresh).not.toEqual(keeping(() => true));
      await apply(tx, async (ctx) => {
        ctx.replan.after({ serviceId }, { fromScratch: true });
        await ctx.replan.lock({ serviceId });
        ctx.replan.after({ serviceId });
      });
      expect(await storedStarts(tx, serviceId)).toEqual(fresh);
    });
  });

  it("fromScratch with a release drops the released Task even though it's pinned", async () => {
    await inRollback(async (tx) => {
      const { serviceId, v1, keeping } = await moved(tx);
      const expected = keeping((key, pinned) => pinned && key !== v1);
      expect(expected).not.toEqual(keeping((_key, pinned) => pinned));
      expect(expected).not.toEqual(keeping((key) => key !== v1));
      await apply(tx, (ctx) => {
        ctx.replan.after({ serviceId }, { fromScratch: true });
        ctx.replan.after({ serviceId }, { release: v1 });
      });
      expect(await storedStarts(tx, serviceId)).toEqual(expected);
    });
  });
});

// Two transactions on two connections. The rows are committed, so they're soft-deleted afterwards
// (Step events stay: the table is append-only). Sources:
// https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS (FOR KEY SHARE conflicts
// with FOR UPDATE only; NOWAIT), https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW
describe("Lock order", () => {
  const softDelete = async (owner: string) => {
    for (const table of ["services", "menus", "recipes", "cooks"]) {
      await db.execute(
        sql`update ${sql.identifier(table)} set deleted_at = now() where owner_id = ${owner} and deleted_at is null`,
      );
    }
  };
  const committedKitchen = async (owner: string) => {
    let k!: Awaited<ReturnType<typeof kitchen>>;
    await db.transaction(async (tx) => void (k = await kitchen(tx, owner)));
    return k;
  };
  const lockRow = async (
    tx: Tx,
    table: typeof services | typeof cooks | typeof recipes,
    id: string,
  ) =>
    void (await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, id))
      .for("no key update"));
  // Whether another transaction holds the row's lock, asked without waiting for it.
  const heldElsewhere = async (
    table: typeof services | typeof cooks | typeof recipes,
    id: string,
  ) => {
    try {
      await db
        .select({ id: table.id })
        .from(table)
        .where(eq(table.id, id))
        .for("no key update", { noWait: true });
      return false;
    } catch (error) {
      if (/could not obtain lock/.test(String((error as Error).cause ?? error))) return true;
      throw error;
    }
  };
  // Starts `mutation` in B and, once it waits for the lock A holds, asks which of `rows` B holds
  // (an error ends a transaction's locks, so this is asked while B waits), then cancels it.
  const heldWhileWaiting = async (
    tx: Tx,
    mutation: () => Promise<unknown>,
    rows: [typeof services | typeof cooks | typeof recipes, string][],
  ) => {
    const pids: unknown = await tx.execute(sql`select pg_backend_pid() as pid`);
    const [{ pid }] = pids as { pid: number }[];
    await tx.execute(sql`set local lock_timeout = '10s'`);
    let settled = false;
    const outcome = mutation().then(
      () => null,
      (e: unknown) => e as Error,
    );
    void outcome.finally(() => (settled = true));
    let waiting = false;
    while (!waiting && !settled) {
      const [row] = (await db.execute(
        sql`select wait_event_type from pg_stat_activity where pid = ${pid}`,
      )) as unknown as Record<string, unknown>[];
      waiting = row?.wait_event_type === "Lock";
    }
    const held = [];
    for (const [table, id] of rows) held.push(await heldElsewhere(table, id));
    await db.execute(sql`select pg_cancel_backend(${pid})`);
    const error = await outcome;
    expect(((error?.cause ?? error) as Error).message).toMatch(
      /canceling statement due to user request/,
    );
    return held;
  };

  it("lock takes the Services in id order, then the Cook", async () => {
    const owner = crypto.randomUUID();
    try {
      const { a, b, c } = await committedKitchen(owner);
      const [first, second, last] = [a, b, c].sort();
      // A holds the last Service: B, waiting for it, holds the others and not yet the Cook.
      await underUncommittedChild(
        (tx) => lockRow(tx, services, last),
        async (tx) => {
          const held = await heldWhileWaiting(
            tx,
            () => apply(tx, (ctx) => ctx.replan.lock({ allServices: true }, { cook: true }), owner),
            [
              [services, first],
              [services, second],
              [cooks, owner],
            ],
          );
          expect(held).toEqual([true, true, false]);
        },
      );
    } finally {
      await softDelete(owner);
    }
  });

  it("after locks its Services at the end, after the mutator's own row, in id order", async () => {
    const owner = crypto.randomUUID();
    try {
      const { w, a, b, c } = await committedKitchen(owner);
      const [first, second, last] = [a, b, c].sort();
      // A holds the last Service: B, waiting for it, holds its Recipe row and the others.
      await underUncommittedChild(
        (tx) => lockRow(tx, services, last),
        async (tx) => {
          const held = await heldWhileWaiting(
            tx,
            () =>
              apply(
                tx,
                async (ctx, tx) => {
                  ctx.replan.after({ allServices: true });
                  await lockRow(tx, recipes, w.recipes.veloute);
                },
                owner,
              ),
            [
              [recipes, w.recipes.veloute],
              [services, first],
              [services, second],
            ],
          );
          expect(held).toEqual([true, true, true]);
        },
      );
    } finally {
      await softDelete(owner);
    }
  });

  it("the Cook's lock doesn't wait for an uncommitted Availability row of the Cook", async () => {
    const owner = crypto.randomUUID();
    try {
      await db.transaction(async (tx) => void (await ensureCook(tx, owner)));
      await underUncommittedChild(
        (tx) =>
          tx.insert(availabilityWeekly).values({
            id: crypto.randomUUID(),
            ownerId: owner,
            cookId: owner,
            weekday: 6,
            startTime: "09:00",
            endTime: "17:00",
          }),
        async (tx) => {
          let locked: unknown;
          await apply(
            tx,
            async (ctx) => (locked = await ctx.replan.lock({ allServices: true }, { cook: true })),
            owner,
          );
          expect(locked).toEqual({ serviceIds: [], cookId: owner });
        },
      );
    } finally {
      await softDelete(owner);
    }
  });

  // Each writer first adds a Step event of the Service, which takes FOR KEY SHARE on it, then
  // locks it through the Re-plan module: at the end (after) or straight away (lock).
  const afterIt = (tx: Tx, serviceId: string, owner: string) =>
    apply(tx, (ctx) => ctx.replan.after({ serviceId }), owner);
  const lockAll = (tx: Tx, _serviceId: string, owner: string) =>
    apply(tx, (ctx) => ctx.replan.lock({ allServices: true }, { cook: true }), owner);
  it.each([
    ["registers it after", "locks every Service and the Cook", afterIt, lockAll],
    ["locks every Service and the Cook", "locks every Service and the Cook", lockAll, lockAll],
  ] as const)(
    "two writers that each add a Step event of a Service and then lock it don't deadlock: A %s, B %s",
    async (_a, _b, first, second) => {
      const owner = crypto.randomUUID();
      const clients = [0, 1].map(() =>
        postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }),
      );
      const [a, b] = clients.map((client) => drizzle({ client }));
      try {
        const { w, a: serviceId } = await committedKitchen(owner);
        const [{ pid: pidOfA }] = (await clients[0]`select pg_backend_pid() as pid`) as unknown as {
          pid: number;
        }[];
        // Inserting a row that references the Service takes FOR KEY SHARE on it.
        const addEvent = (tx: Tx) =>
          tx.insert(stepEvents).values({
            id: crypto.randomUUID(),
            ownerId: owner,
            serviceId,
            dishId: w.dishes.veloute,
            stepId: w.steps.V1,
            kind: "done",
            at: FIXED_NOW,
          });

        let addedA!: () => void;
        const aAdded = new Promise<void>((resolve) => (addedA = resolve));
        let addedB!: () => void;
        const bAdded = new Promise<void>((resolve) => (addedB = resolve));
        let goOn!: () => void;
        const aWaitsOrIsDone = new Promise<void>((resolve) => (goOn = resolve));
        let settled = false;
        // A locks the Service once B holds its key share.
        const txA = a
          .transaction(async (tx) => {
            await addEvent(tx);
            addedA();
            await bAdded;
            await first(tx, serviceId, owner);
          })
          .finally(() => (settled = true));
        // B locks it once A is waiting for, or has, the Service's lock.
        const txB = b.transaction(async (tx) => {
          await aAdded;
          await addEvent(tx);
          addedB();
          await aWaitsOrIsDone;
          await second(tx, serviceId, owner);
        });
        await bAdded;
        while (!settled) {
          const [row] = (await db.execute(
            sql`select wait_event_type from pg_stat_activity where pid = ${pidOfA}`,
          )) as unknown as Record<string, unknown>[];
          if (row?.wait_event_type === "Lock") break;
        }
        goOn();

        const results = await Promise.allSettled([txA, txB]);
        expect(
          results.map((r) =>
            r.status === "rejected" ? String((r.reason as Error).cause ?? r.reason) : "ok",
          ),
        ).toEqual(["ok", "ok"]);
      } finally {
        await softDelete(owner);
        await Promise.all(clients.map((c) => c.end()));
      }
    },
  );
});
