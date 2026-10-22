import { appliedMutations, defineMutator, menus, mutators } from "@miseflow/shared";
import { eq } from "drizzle-orm";
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
