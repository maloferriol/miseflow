import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { db, inRollback } from "../../test/db.ts";
import {
  buildWalkthrough,
  SERVICE_DATE,
  SERVICE_TIME,
  setWalkthroughAvailability,
} from "../../test/walkthrough.ts";
import { batchId } from "../plan/batch-rows.ts";
import { lockService, readPlan } from "../plan/replan.ts";
import { schedule } from "../scheduler/schedule.ts";
import {
  batches,
  courses,
  dishes,
  ingredients,
  menus,
  recipes,
  shoppingCategories,
  taskPlacements,
} from "../schema.ts";
import { getMutator, NotFoundError, type Tx } from "./registry.ts";

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
const FIXED_NOW = new Date("2026-10-26T12:00:00Z");

const ownerId = crypto.randomUUID();

describe("mutator registry", () => {
  it("finds a mutator by name", () => {
    expect(getMutator("createMenu")?.name).toBe("createMenu");
  });

  it("returns undefined for an unknown name, including Object.prototype keys", () => {
    expect(getMutator("nope")).toBeUndefined();
    expect(getMutator("toString")).toBeUndefined();
    expect(getMutator("__proto__")).toBeUndefined();
  });
});

describe("createMenu args", () => {
  const args = getMutator("createMenu")!.args;
  const valid = { menuId: crypto.randomUUID(), name: "Saturday dinner", guestCount: 6 };

  it("accepts a Menu with a name and guest count", () => {
    expect(args.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(args.safeParse({ ...valid, name: undefined }).success).toBe(false);
  });

  it("rejects a guest count that is not a whole number of at least 1", () => {
    expect(args.safeParse({ ...valid, guestCount: 2.5 }).success).toBe(false);
    expect(args.safeParse({ ...valid, guestCount: 0 }).success).toBe(false);
  });

  it("rejects a menuId that is not a uuid", () => {
    expect(args.safeParse({ ...valid, menuId: "menu-1" }).success).toBe(false);
  });
});

describe("createMenu", () => {
  it("inserts the Menu stamped with the owner", async () => {
    const menuId = crypto.randomUUID();
    await inRollback(async (tx) => {
      const mutator = getMutator("createMenu")!;
      await mutator.run(
        tx,
        mutator.args.parse({ menuId, name: "Saturday dinner", guestCount: 6 }),
        {
          ownerId,
          timeZone: "Europe/Paris",
          now: () => FIXED_NOW,
        },
      );
      const rows = await tx.select().from(menus).where(eq(menus.id, menuId));
      expect(rows).toMatchObject([{ name: "Saturday dinner", guestCount: 6, ownerId }]);
    });
  });
});

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), {
    ownerId: owner,
    timeZone: "Europe/Paris",
    now: () => FIXED_NOW,
  });
}

describe("addCourse", () => {
  it("appends each Course after the last one in the Menu", async () => {
    const menuId = crypto.randomUUID();
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
    await inRollback(async (tx) => {
      await run(tx, "createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
      await run(tx, "addCourse", { courseId: first, menuId, name: "Starter" });
      await run(tx, "addCourse", { courseId: second, menuId, name: "Main" });

      const rows = await tx.select().from(courses).where(eq(courses.menuId, menuId));
      const position = (id: string) => rows.find((r) => r.id === id)!.position;
      expect(position(first) < position(second)).toBe(true);
      expect(rows.every((r) => r.ownerId === ownerId)).toBe(true);
    });
  });

  it("refuses another owner's Menu", async () => {
    const menuId = crypto.randomUUID();
    await inRollback(async (tx) => {
      await run(tx, "createMenu", { menuId, name: "Theirs", guestCount: 2 }, crypto.randomUUID());
      await expect(
        run(tx, "addCourse", { courseId: crypto.randomUUID(), menuId, name: "Starter" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("addDish", () => {
  it("places the Recipe in the Course", async () => {
    const [menuId, courseId, recipeId, dishId] = Array.from({ length: 4 }, () =>
      crypto.randomUUID(),
    );
    await inRollback(async (tx) => {
      await run(tx, "createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
      await run(tx, "addCourse", { courseId, menuId, name: "Starter" });
      await run(tx, "createRecipe", { recipeId, revisionId: crypto.randomUUID(), name: "Velouté" });
      await run(tx, "addDish", { dishId, courseId, recipeId });

      const rows = await tx.select().from(dishes).where(eq(dishes.id, dishId));
      expect(rows).toMatchObject([{ courseId, recipeId, ownerId }]);
    });
  });

  it("refuses another owner's Recipe", async () => {
    const [menuId, courseId, recipeId] = Array.from({ length: 3 }, () => crypto.randomUUID());
    await inRollback(async (tx) => {
      await run(tx, "createMenu", { menuId, name: "Saturday dinner", guestCount: 6 });
      await run(tx, "addCourse", { courseId, menuId, name: "Starter" });
      await tx
        .insert(recipes)
        .values({ id: recipeId, ownerId: crypto.randomUUID(), name: "Theirs" });
      await expect(
        run(tx, "addDish", { dishId: crypto.randomUUID(), courseId, recipeId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

// removeDish (#90 AC3): the walkthrough with its Service and Availability, in the test's transaction.
const timeZone = "Europe/Paris";
type Options = Parameters<typeof buildWalkthrough>[2];
async function walkthrough(tx: Tx, options: Options) {
  const s = crypto.randomUUID().slice(0, 8);
  const w = await buildWalkthrough((name, args) => run(tx, name, args), s, options);
  await setWalkthroughAvailability((name, args) => run(tx, name, args));
  const serviceId = crypto.randomUUID();
  await run(tx, "createService", {
    serviceId,
    menuId: w.menuId,
    date: SERVICE_DATE,
    time: SERVICE_TIME,
  });
  return { w, s, serviceId };
}

// The shopping walkthrough's Ingredients (it moves the pastry Steps into a Pastry sub-recipe).
async function shoppingIds(tx: Tx) {
  const category = crypto.randomUUID();
  await tx
    .insert(shoppingCategories)
    .values({ id: category, ownerId: null, name: `Misc ${category.slice(0, 8)}`, position: "a0" });
  const names = ["shallot", "butter", "flour", "salt", "apple", "sugar"] as const;
  const ids = {} as Record<(typeof names)[number], string>;
  for (const name of names) {
    ids[name] = crypto.randomUUID();
    await tx.insert(ingredients).values({
      id: ids[name],
      ownerId: null,
      name: `${name} ${category.slice(0, 8)}`,
      source: "seed",
      preferredKind: name === "apple" ? "count" : "mass",
      shoppingCategoryId: category,
    });
  }
  return ids;
}

// Each live placement of the Service: its Task's owner and start, by its first Step.
async function livePlacements(tx: Tx, serviceId: string) {
  const rows = await tx
    .select({
      stepId: taskPlacements.firstStepId,
      dishId: taskPlacements.dishId,
      batchId: taskPlacements.batchId,
      start: taskPlacements.startMinute,
    })
    .from(taskPlacements)
    .where(and(eq(taskPlacements.serviceId, serviceId), isNull(taskPlacements.deletedAt)));
  return new Map(rows.map((r) => [r.stepId, r]));
}

const deletedAt = async (tx: Tx, table: typeof dishes | typeof batches, id: string) =>
  (await tx.select({ deletedAt: table.deletedAt }).from(table).where(eq(table.id, id)))[0]
    ?.deletedAt;

const tableWrites = async (tx: Tx, table: string) =>
  Number(
    (
      (await tx.execute(sql`select n_tup_ins + n_tup_upd + n_tup_del as n
      from pg_stat_xact_user_tables where relname = ${table}`)) as { n: string }[]
    )[0]?.n ?? 0,
  );

const batchLabels = async (tx: Tx, serviceId: string) =>
  (await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW)).batches.map((b) => b.label);

describe("removeDish", () => {
  it("AC3: removeDish on Tarte tatin soft-deletes it, its Pastry Batch drops out, and the Plan re-fits", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx, { shopping: await shoppingIds(tx) });
      const pastry = await batchId(serviceId, w.recipes.pastry!);
      const before = await livePlacements(tx, serviceId);
      expect([...before.values()].some((p) => p.batchId === pastry)).toBe(true);
      expect([...before.values()].some((p) => p.dishId === w.dishes.tarte)).toBe(true);

      await run(tx, "removeDish", { dishId: w.dishes.tarte });
      expect(await deletedAt(tx, dishes, w.dishes.tarte)).not.toBeNull();
      expect(await deletedAt(tx, batches, pastry)).not.toBeNull();
      const after = await livePlacements(tx, serviceId);
      expect(
        [...after.values()].filter((p) => p.dishId === w.dishes.tarte || p.batchId === pastry),
      ).toEqual([]);
      // Only what must move moves: every other Task keeps its start.
      const kept = [...before.values()].filter(
        (p) => p.dishId !== w.dishes.tarte && p.batchId !== pastry,
      );
      expect(after).toEqual(new Map(kept.map((p) => [p.stepId, p])));
      // The stored Plan is what the scheduler gives over it, with nothing Unplaced.
      const plan = await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW);
      expect(plan.unplaced).toEqual([]);
      const fresh = schedule(plan.model);
      expect(fresh.unplaced).toEqual([]);
      expect(new Map(plan.days.flatMap((d) => d.tasks).map((t) => [t.key, t.startMinute]))).toEqual(
        new Map(fresh.placements.map((p) => [p.key, p.start])),
      );
    });
  });

  it("AC3: removeDish on Velouté keeps the stock Batch, which the Beurre blanc still uses", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await walkthrough(tx, { stock: true });
      const stock = await batchId(serviceId, w.recipes.stock!);
      await run(tx, "removeDish", { dishId: w.dishes.veloute });
      expect(await deletedAt(tx, batches, stock)).toBeNull();
      expect(await batchLabels(tx, serviceId)).toEqual([
        `Beurre blanc ${s} ×1 · for: Duck breast with beurre blanc ${s}`,
        `Chicken stock ${s} ×0.38 · for: Beurre blanc ${s}`,
      ]);
      expect(
        [...(await livePlacements(tx, serviceId)).values()].filter(
          (p) => p.dishId === w.dishes.veloute,
        ),
      ).toEqual([]);
      expect((await readPlan(tx, ownerId, serviceId, timeZone, FIXED_NOW)).unplaced).toEqual([]);
    });
  });

  it("AC3: nested Batches: removing the Duck drops the Beurre blanc but keeps the stock; removing the Velouté then drops the stock", async () => {
    await inRollback(async (tx) => {
      const { w, s, serviceId } = await walkthrough(tx, { stock: true });
      const stock = await batchId(serviceId, w.recipes.stock!);
      const beurre = await batchId(serviceId, w.recipes.beurre!);
      await run(tx, "removeDish", { dishId: w.dishes.duck });
      expect(await deletedAt(tx, batches, beurre)).not.toBeNull();
      expect(await deletedAt(tx, batches, stock)).toBeNull();
      expect(await batchLabels(tx, serviceId)).toEqual([
        `Chicken stock ${s} ×1.13 · for: Velouté ${s}`,
      ]);
      expect(
        [...(await livePlacements(tx, serviceId)).values()].filter(
          (p) => p.batchId === beurre || p.dishId === w.dishes.duck,
        ),
      ).toEqual([]);

      await run(tx, "removeDish", { dishId: w.dishes.veloute });
      expect(await deletedAt(tx, batches, stock)).not.toBeNull();
      expect(
        [...(await livePlacements(tx, serviceId)).values()].filter((p) => p.batchId !== null),
      ).toEqual([]);
      expect(await batchLabels(tx, serviceId)).toEqual([]);
    });
  });

  it("AC3: another owner's Dish, a removed one and an unknown id are NotFound, writing nothing", async () => {
    await inRollback(async (tx) => {
      const { w, serviceId } = await walkthrough(tx, { stock: true });
      await run(tx, "removeDish", { dishId: w.dishes.tarte });
      const before = [
        await tableWrites(tx, "dishes"),
        await tableWrites(tx, "task_placements"),
        await livePlacements(tx, serviceId),
      ];
      const refused = async (dishId: string, owner = ownerId) => {
        let thrown: unknown;
        await tx
          .transaction(async (sp) => run(sp, "removeDish", { dishId }, owner))
          .catch((e) => (thrown = e));
        return thrown;
      };
      expect(await refused(w.dishes.duck, crypto.randomUUID())).toEqual(new NotFoundError("Dish"));
      expect(await refused(w.dishes.tarte)).toEqual(new NotFoundError("Dish"));
      expect(await refused(crypto.randomUUID())).toEqual(new NotFoundError("Dish"));
      expect([
        await tableWrites(tx, "dishes"),
        await tableWrites(tx, "task_placements"),
        await livePlacements(tx, serviceId),
      ]).toEqual(before);
      expect(await deletedAt(tx, dishes, w.dishes.duck)).toBeNull();
    });
  });
});

// Two transactions on two connections, ordered with awaits. The rows are committed, so they're
// soft-deleted afterwards (the Step events stay: the table is append-only). Sources:
// https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS (FOR KEY SHARE conflicts
// with FOR UPDATE only), https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW
describe("removeDish locks", () => {
  it("removeDish and a tickStep of the same Dish on its Service both commit, with no deadlock", async () => {
    const owner = crypto.randomUUID();
    const clients = [0, 1].map(() =>
      postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }),
    );
    const [a, b] = clients.map((client) => drizzle({ client }));
    const as = (tx: Tx) => (name: string, args: Record<string, unknown>) =>
      run(tx, name, args, owner);
    const serviceId = crypto.randomUUID();
    try {
      let w!: Awaited<ReturnType<typeof buildWalkthrough>>;
      await db.transaction(async (tx) => {
        w = await buildWalkthrough(as(tx), owner.slice(0, 8));
        await setWalkthroughAvailability(as(tx));
        await as(tx)("createService", {
          serviceId,
          menuId: w.menuId,
          date: SERVICE_DATE,
          time: SERVICE_TIME,
        });
      });
      const [{ pid: pidOfA }] = (await clients[0]`select pg_backend_pid() as pid`) as unknown as {
        pid: number;
      }[];

      let lockedService!: () => void;
      const serviceLocked = new Promise<void>((resolve) => (lockedService = resolve));
      let goOn!: () => void;
      const aWaitsOrIsDone = new Promise<void>((resolve) => (goOn = resolve));
      // B: tickStep on the Velouté, paused right after it locks the Service (its first lock).
      const txB = b.transaction(async (tx) => {
        await lockService(tx, owner, serviceId);
        lockedService();
        await aWaitsOrIsDone;
        await run(
          tx,
          "tickStep",
          {
            eventId: crypto.randomUUID(),
            serviceId,
            owner: { kind: "dish", dishId: w.dishes.veloute },
            stepId: w.steps.V1,
          },
          owner,
        );
      });
      await serviceLocked;
      // A: removeDish locks the Dish, soft-deletes it, then waits for the Service in its re-plan.
      let settled = false;
      const txA = a
        .transaction(async (tx) => run(tx, "removeDish", { dishId: w.dishes.veloute }, owner))
        .finally(() => (settled = true));
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
      const [dish] = (await db.execute(
        sql`select deleted_at from dishes where id = ${w.dishes.veloute}`,
      )) as unknown as Record<string, unknown>[];
      expect(dish.deleted_at).not.toBeNull();
      const live = (await db.execute(
        sql`select 1 from task_placements where dish_id = ${w.dishes.veloute} and deleted_at is null`,
      )) as unknown as unknown[];
      expect(live).toEqual([]);
    } finally {
      await db.execute(
        sql`update task_placements set deleted_at = now() where owner_id = ${owner} and deleted_at is null`,
      );
      await db.execute(
        sql`update services set deleted_at = now() where owner_id = ${owner} and deleted_at is null`,
      );
      await db.execute(
        sql`update menus set deleted_at = now() where owner_id = ${owner} and deleted_at is null`,
      );
      await db.execute(
        sql`update recipes set deleted_at = now() where owner_id = ${owner} and deleted_at is null`,
      );
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
