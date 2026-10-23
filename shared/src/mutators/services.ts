import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { lockCook } from "../plan/replan.ts";
import { toTimeColumn } from "../plan/time.ts";
import { availabilityOverrides, availabilityWeekly, kitchenSettings } from "../schema.ts";
import { ConflictError, defineMutator } from "./define.ts";

// Services, the kitchen's default Service time and the implicit Cook's Availability (#86).
// A time of day is a minute of day on the 5-minute grid; an end may be 1440 (midnight).

const minuteOfDay = z.int().min(0).max(1435).multipleOf(5);
const endOfDay = z.int().min(5).max(1440).multipleOf(5);
const endAfterStart = { message: "Hours must end after they start" };

export const setKitchenSettings = defineMutator({
  name: "setKitchenSettings",
  args: z.strictObject({ defaultServiceTime: minuteOfDay }),
  async run(tx, args, { ownerId }) {
    // One row per owner, its id the owner's (D1), so the save is one atomic upsert.
    // Source: https://orm.drizzle.team/docs/insert#on-conflict-do-update (setWhere)
    const time = toTimeColumn(args.defaultServiceTime);
    const written = await tx
      .insert(kitchenSettings)
      .values({ id: ownerId, ownerId, defaultServiceTime: time })
      .onConflictDoUpdate({
        target: kitchenSettings.id,
        set: { defaultServiceTime: time, deletedAt: null, updatedAt: sql`now()` },
        setWhere: eq(kitchenSettings.ownerId, ownerId),
      })
      .returning({ id: kitchenSettings.id });
    if (!written.length) throw new ConflictError("A row with one of these ids already exists");
  },
});

const weeklyHours = z
  .strictObject({ availabilityId: z.uuid(), weekday: z.int().min(0).max(6), start: minuteOfDay, end: endOfDay })
  .refine((h) => h.end > h.start, endAfterStart);

/** The whole week at once (D10): the Cook's live weekly hours are replaced by these. */
export const setWeeklyAvailability = defineMutator({
  name: "setWeeklyAvailability",
  args: z.strictObject({
    hours: z
      .array(weeklyHours)
      .max(28)
      .refine(
        (hours) =>
          hours.every((a, i) => hours.every((b, j) => i === j || a.weekday !== b.weekday || a.end <= b.start || b.end <= a.start)),
        { message: "Hours can't overlap on one weekday" },
      )
      .refine((hours) => new Set(hours.map((h) => h.availabilityId)).size === hours.length, {
        message: "Each row needs its own id",
      }),
  }),
  async run(tx, args, { ownerId }) {
    const cookId = await lockCook(tx, ownerId);
    await tx
      .update(availabilityWeekly)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(availabilityWeekly.cookId, cookId),
          eq(availabilityWeekly.ownerId, ownerId),
          isNull(availabilityWeekly.deletedAt),
        ),
      );
    for (const h of args.hours) {
      const values = { weekday: h.weekday, startTime: toTimeColumn(h.start), endTime: toTimeColumn(h.end) };
      // A row id sent again (from the Availability read) brings that row back with the new hours.
      const written = await tx
        .insert(availabilityWeekly)
        .values({ id: h.availabilityId, ownerId, cookId, ...values })
        .onConflictDoUpdate({
          target: availabilityWeekly.id,
          set: { ...values, deletedAt: null, updatedAt: sql`now()` },
          setWhere: and(eq(availabilityWeekly.ownerId, ownerId), eq(availabilityWeekly.cookId, cookId)),
        })
        .returning({ id: availabilityWeekly.id });
      if (!written.length) throw new ConflictError("A row with one of these ids already exists");
    }
  },
});

/** One date's hours, or not available that date ("off"), or back to the weekly hours ("weekly"). */
export const setAvailabilityOverride = defineMutator({
  name: "setAvailabilityOverride",
  args: z.strictObject({
    overrideId: z.uuid(),
    date: z.iso.date(),
    availability: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("hours"), start: minuteOfDay, end: endOfDay }).refine((h) => h.end > h.start, endAfterStart),
      z.strictObject({ kind: z.literal("off") }),
      z.strictObject({ kind: z.literal("weekly") }),
    ]),
  }),
  async run(tx, args, { ownerId }) {
    const cookId = await lockCook(tx, ownerId);
    await tx
      .update(availabilityOverrides)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(availabilityOverrides.cookId, cookId),
          eq(availabilityOverrides.ownerId, ownerId),
          eq(availabilityOverrides.date, args.date),
          isNull(availabilityOverrides.deletedAt),
        ),
      );
    const a = args.availability;
    if (a.kind === "weekly") return;
    const values = {
      date: args.date,
      startTime: a.kind === "hours" ? toTimeColumn(a.start) : null,
      endTime: a.kind === "hours" ? toTimeColumn(a.end) : null,
    };
    const written = await tx
      .insert(availabilityOverrides)
      .values({ id: args.overrideId, ownerId, cookId, ...values })
      .onConflictDoUpdate({
        target: availabilityOverrides.id,
        set: { ...values, deletedAt: null, updatedAt: sql`now()` },
        setWhere: and(eq(availabilityOverrides.ownerId, ownerId), eq(availabilityOverrides.cookId, cookId)),
      })
      .returning({ id: availabilityOverrides.id });
    if (!written.length) throw new ConflictError("A row with one of these ids already exists");
  },
});
