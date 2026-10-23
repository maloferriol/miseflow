import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inRollback } from "../../test/db.ts";
import { ensureCook, loadAvailability } from "../plan/replan.ts";
import { availabilityOverrides, availabilityWeekly, cooks, kitchenSettings } from "../schema.ts";
import { getMutator, type Tx } from "./registry.ts";

const ownerId = crypto.randomUUID();
const timeZone = "Europe/Paris";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

async function run(tx: Tx, name: string, args: unknown, owner = ownerId) {
  const mutator = getMutator(name)!;
  await mutator.run(tx, mutator.args.parse(args), { ownerId: owner, timeZone });
}

const hours = (weekday: number, start: number, end: number) => ({ availabilityId: crypto.randomUUID(), weekday, start, end });

describe("Availability and kitchen settings", () => {
  it("makes the implicit Cook with the owner's id, and a second ensureCook writes nothing", async () => {
    await inRollback(async (tx) => {
      expect(await ensureCook(tx, ownerId)).toBe(ownerId);
      const [first] = await tx.select().from(cooks).where(eq(cooks.id, ownerId));
      expect(await ensureCook(tx, ownerId)).toBe(ownerId);
      const rows = await tx.select().from(cooks).where(eq(cooks.ownerId, ownerId));
      expect(rows).toEqual([first]);
      expect(first).toMatchObject({ ownerId, name: "Me" });
    });
  });

  it("replaces the whole week, and stores an end at midnight as 24:00:00, read back as 1440", async () => {
    await inRollback(async (tx) => {
      await run(tx, "setWeeklyAvailability", { hours: [hours(1, h(9), h(12))] });
      await run(tx, "setWeeklyAvailability", { hours: [hours(4, h(18), h(22)), hours(6, h(18), 1440)] });

      const live = await tx
        .select({ weekday: availabilityWeekly.weekday, endTime: availabilityWeekly.endTime })
        .from(availabilityWeekly)
        .where(and(eq(availabilityWeekly.ownerId, ownerId), isNull(availabilityWeekly.deletedAt)));
      expect(live.map((r) => r.weekday).sort()).toEqual([4, 6]);
      expect(live.find((r) => r.weekday === 6)!.endTime).toBe("24:00:00");
      expect((await loadAvailability(tx, ownerId)).weekly).toEqual([
        { id: expect.any(String), weekday: 4, start: h(18), end: h(22) },
        { id: expect.any(String), weekday: 6, start: h(18), end: 1440 },
      ]);
    });
  });

  it("refuses hours that end before they start or overlap on one weekday", () => {
    const mutator = getMutator("setWeeklyAvailability")!;
    expect(mutator.args.safeParse({ hours: [hours(4, h(22), h(18))] }).success).toBe(false);
    expect(mutator.args.safeParse({ hours: [hours(4, h(18), h(22)), hours(4, h(21), h(23))] }).success).toBe(false);
    expect(mutator.args.safeParse({ hours: [hours(4, h(18), h(22)), hours(5, h(21), h(23))] }).success).toBe(true);
  });

  it("sets a date's override, and kind weekly clears it", async () => {
    await inRollback(async (tx) => {
      const date = "2026-10-30";
      await run(tx, "setAvailabilityOverride", { overrideId: crypto.randomUUID(), date, availability: { kind: "hours", start: h(19), end: h(21) } });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([{ id: expect.any(String), date, hours: { start: h(19), end: h(21) } }]);
      await run(tx, "setAvailabilityOverride", { overrideId: crypto.randomUUID(), date, availability: { kind: "off" } });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([{ id: expect.any(String), date, hours: null }]);

      await run(tx, "setAvailabilityOverride", { overrideId: crypto.randomUUID(), date, availability: { kind: "weekly" } });
      expect((await loadAvailability(tx, ownerId)).overrides).toEqual([]);
      const rows = await tx.select().from(availabilityOverrides).where(eq(availabilityOverrides.ownerId, ownerId));
      expect(rows).toHaveLength(2);
    });
  });

  it("saves the kitchen's default Service time in one settings row per owner", async () => {
    await inRollback(async (tx) => {
      await run(tx, "setKitchenSettings", { defaultServiceTime: h(19, 30) });
      await run(tx, "setKitchenSettings", { defaultServiceTime: h(18) });
      const rows = await tx.select().from(kitchenSettings).where(eq(kitchenSettings.ownerId, ownerId));
      expect(rows).toMatchObject([{ id: ownerId, defaultServiceTime: "18:00:00" }]);
    });
  });
});
