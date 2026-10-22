import {
  appliedMutations,
  courses,
  defineMutator,
  dishes,
  menus,
  mutators,
  recipeRevisions,
  recipes,
} from "@miseflow/shared";
import { eq, inArray } from "drizzle-orm";
import { decode } from "hono/jwt";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { db, getToken, testApp } from "./helpers.ts";

async function postMutation(body: unknown, app = testApp()) {
  return app.request("/mutate", {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const createMenu = (menuId = crypto.randomUUID()) => ({
  id: crypto.randomUUID(),
  name: "createMenu",
  args: { menuId, name: "Saturday dinner", guestCount: 6 },
});

describe("POST /mutate", () => {
  it("applies a retried mutation id once, and both responses succeed", async () => {
    const mutation = createMenu();

    const first = await postMutation(mutation);
    const second = await postMutation(mutation);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await second.json()).toEqual({ ok: true, id: mutation.id });
    const menuRows = await db.select().from(menus).where(eq(menus.id, mutation.args.menuId));
    expect(menuRows).toHaveLength(1);
    const applied = await db.select().from(appliedMutations).where(eq(appliedMutations.id, mutation.id));
    expect(applied).toMatchObject([{ name: "createMenu" }]);
  });

  it("refuses a known mutation id sent by another owner with 409", async () => {
    const mutation = createMenu();
    await db
      .insert(appliedMutations)
      .values({ id: mutation.id, ownerId: crypto.randomUUID(), name: "createMenu" });

    const res = await postMutation(mutation);

    expect(res.status).toBe(409);
    expect(await db.select().from(menus).where(eq(menus.id, mutation.args.menuId))).toHaveLength(0);
  });

  it("answers a new mutation id that reuses an existing menuId with 409", async () => {
    const menuId = crypto.randomUUID();
    expect((await postMutation(createMenu(menuId))).status).toBe(200);
    const again = createMenu(menuId);

    const res = await postMutation(again);

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONFLICT");
    expect(
      await db.select().from(appliedMutations).where(eq(appliedMutations.id, again.id)),
    ).toHaveLength(0);
  });

  it("rolls back every row when the mutator throws", async () => {
    const failing = defineMutator({
      name: "createMenuThenFail",
      args: z.object({ menuId: z.uuid() }),
      async run(tx, args, { ownerId }) {
        await tx.insert(menus).values({ id: args.menuId, ownerId, name: "Doomed" });
        throw new Error("boom");
      },
    });
    const app = testApp({ mutators: { ...mutators, createMenuThenFail: failing } });
    const mutation = { id: crypto.randomUUID(), name: "createMenuThenFail", args: { menuId: crypto.randomUUID() } };

    const res = await postMutation(mutation, app);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Internal error" } });
    expect(await db.select().from(menus).where(eq(menus.id, mutation.args.menuId))).toHaveLength(0);
    expect(
      await db.select().from(appliedMutations).where(eq(appliedMutations.id, mutation.id)),
    ).toHaveLength(0);
  });

  it("answers an unknown mutation name with 400", async () => {
    const res = await postMutation({ ...createMenu(), name: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNKNOWN_MUTATION");
  });

  it("answers invalid args with 400", async () => {
    const mutation = createMenu();
    const res = await postMutation({ ...mutation, args: { ...mutation.args, guestCount: 0 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_ARGS");
  });

  it("answers a body that is not a mutation with 400", async () => {
    const res = await postMutation({ id: "not-a-uuid", name: "createMenu" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_BODY");
  });
});

describe("positions", () => {
  it("gives parallel addCourse calls on one Menu distinct, ordered positions", async () => {
    const menuId = crypto.randomUUID();
    expect((await postMutation(createMenu(menuId))).status).toBe(200);
    const courseIds = Array.from({ length: 5 }, () => crypto.randomUUID());

    const statuses = await Promise.all(
      courseIds.map(async (courseId, i) =>
        (
          await postMutation({
            id: crypto.randomUUID(),
            name: "addCourse",
            args: { courseId, menuId, name: `Course ${i}` },
          })
        ).status,
      ),
    );

    expect(statuses).toEqual(Array(5).fill(200));
    const positions = (
      await db.select({ position: courses.position }).from(courses).where(eq(courses.menuId, menuId))
    ).map((r) => r.position);
    expect(new Set(positions).size).toBe(5);
  });
});

describe("owner stamping", () => {
  it("stamps owner_id with the token's sub on every row written", async () => {
    const sub = decode(await getToken()).payload.sub;
    const [menuId, courseId, recipeId, revisionId, dishId] = Array.from({ length: 5 }, () =>
      crypto.randomUUID(),
    );
    const sent = [
      { name: "createMenu", args: { menuId, name: "Saturday dinner", guestCount: 6 } },
      { name: "addCourse", args: { courseId, menuId, name: "Starter" } },
      { name: "createRecipe", args: { recipeId, revisionId, name: "Velouté" } },
      { name: "addDish", args: { dishId, courseId, recipeId } },
    ].map((m) => ({ id: crypto.randomUUID(), ...m }));

    for (const mutation of sent) expect((await postMutation(mutation)).status).toBe(200);

    const owners = [
      ...(await db.select({ o: menus.ownerId }).from(menus).where(eq(menus.id, menuId))),
      ...(await db.select({ o: courses.ownerId }).from(courses).where(eq(courses.id, courseId))),
      ...(await db.select({ o: recipes.ownerId }).from(recipes).where(eq(recipes.id, recipeId))),
      ...(await db
        .select({ o: recipeRevisions.ownerId })
        .from(recipeRevisions)
        .where(eq(recipeRevisions.id, revisionId))),
      ...(await db.select({ o: dishes.ownerId }).from(dishes).where(eq(dishes.id, dishId))),
      ...(await db
        .select({ o: appliedMutations.ownerId })
        .from(appliedMutations)
        .where(inArray(appliedMutations.id, sent.map((m) => m.id)))),
    ].map((r) => r.o);
    expect(owners).toEqual(Array(9).fill(sub));
  });

  it("answers a mutation on another owner's Menu with 404 and writes nothing", async () => {
    const menuId = crypto.randomUUID();
    await db.insert(menus).values({ id: menuId, ownerId: crypto.randomUUID(), name: "Theirs" });
    const courseId = crypto.randomUUID();

    const res = await postMutation({
      id: crypto.randomUUID(),
      name: "addCourse",
      args: { courseId, menuId, name: "Starter" },
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(await db.select().from(courses).where(eq(courses.id, courseId))).toHaveLength(0);
  });
});
