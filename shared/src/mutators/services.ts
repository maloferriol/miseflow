import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Hours } from "../plan/model.ts";
import { smallestOverride } from "../plan/more-time.ts";
import {
  findLiveService,
  loadPlanRows,
  lockCook,
  lockServices,
  replan,
  replanAffected,
  replanFromScratchOf,
} from "../plan/replan.ts";
import { toTimeColumn } from "../plan/time.ts";
import { taskKey } from "../scheduler/types.ts";
import {
  availabilityOverrides,
  availabilityWeekly,
  kitchenSettings,
  menus,
  services,
} from "../schema.ts";
import {
  ConflictError,
  defineMutator,
  InvalidArgsError,
  NotFoundError,
  type Tx,
} from "./define.ts";

// Services, the kitchen's default Service time and the implicit Cook's Availability (#86).
// A time of day is a minute of day on the 5-minute grid; an end may be 1440 (midnight).

const minuteOfDay = z.int().min(0).max(1435).multipleOf(5);
const endOfDay = z.int().min(5).max(1440).multipleOf(5);
const endAfterStart = { message: "Hours must end after they start" };

/** The one Service of a Menu (ADR 0010), at a date and an optional time (null: the kitchen's default). */
export const createService = defineMutator({
  name: "createService",
  args: z.strictObject({
    serviceId: z.uuid(),
    menuId: z.uuid(),
    date: z.iso.date(),
    time: minuteOfDay.nullable(),
  }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    // The Menu's lock, so two concurrent createService calls check for a Service one after another.
    const [menu] = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.id, args.menuId), eq(menus.ownerId, ownerId), isNull(menus.deletedAt)))
      .for("update");
    if (!menu) throw new NotFoundError("Menu");
    const [existing] = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.menuId, args.menuId), isNull(services.deletedAt)));
    if (existing) throw new ConflictError("This Menu already has a Service");
    // `services.menu_id` is unique, so a soft-deleted Service still holds the Menu: 23505 → 409.
    await tx.insert(services).values({
      id: args.serviceId,
      ownerId,
      menuId: args.menuId,
      date: args.date,
      time: args.time === null ? null : toTimeColumn(args.time),
    });
    await replan(tx, ctx, args.serviceId);
  },
});

/** The Service's "when": its date and its time (null: the kitchen's default). */
export const setServiceTime = defineMutator({
  name: "setServiceTime",
  args: z.strictObject({ serviceId: z.uuid(), date: z.iso.date(), time: minuteOfDay.nullable() }),
  async run(tx, args, ctx) {
    const updated = await tx
      .update(services)
      .set({
        date: args.date,
        time: args.time === null ? null : toTimeColumn(args.time),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(services.id, args.serviceId),
          eq(services.ownerId, ctx.ownerId),
          isNull(services.deletedAt),
        ),
      )
      .returning({ id: services.id });
    if (!updated.length) throw new NotFoundError("Service");
    await replan(tx, ctx, args.serviceId);
  },
});

/** Fits the Service's Plan again on request; writes only what moved. */
export const replanService = defineMutator({
  name: "replanService",
  args: z.strictObject({ serviceId: z.uuid() }),
  async run(tx, args, ctx) {
    await replan(tx, ctx, args.serviceId);
  },
});

/**
 * "Re-plan from scratch" (#90 AC4): places the Service's Tasks as if there were no previous Plan,
 * keeping pinned Tasks and Tasks with a ticked Step where they are (owner decision 5).
 */
export const replanFromScratch = defineMutator({
  name: "replanFromScratch",
  args: z.strictObject({ serviceId: z.uuid() }),
  async run(tx, args, ctx) {
    await replanFromScratchOf(tx, ctx, args.serviceId);
  },
});

export const setKitchenSettings = defineMutator({
  name: "setKitchenSettings",
  args: z.strictObject({ defaultServiceTime: minuteOfDay }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
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
    // Only Services without their own time follow the default.
    await replanAffected(tx, ctx, { allServices: true, onlyDefaultTime: true });
  },
});

const weeklyHours = z
  .strictObject({
    availabilityId: z.uuid(),
    weekday: z.int().min(0).max(6),
    start: minuteOfDay,
    end: endOfDay,
  })
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
          hours.every((a, i) =>
            hours.every(
              (b, j) => i === j || a.weekday !== b.weekday || a.end <= b.start || b.end <= a.start,
            ),
          ),
        { message: "Hours can't overlap on one weekday" },
      )
      .refine((hours) => new Set(hours.map((h) => h.availabilityId)).size === hours.length, {
        message: "Each row needs its own id",
      }),
  }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    // Lock order Service, then Cook (D6); every Service follows the Cook's Availability.
    const serviceIds = await lockServices(tx, ownerId, { allServices: true });
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
      const values = {
        weekday: h.weekday,
        startTime: toTimeColumn(h.start),
        endTime: toTimeColumn(h.end),
      };
      // A row id sent again (from the Availability read) brings that row back with the new hours.
      const written = await tx
        .insert(availabilityWeekly)
        .values({ id: h.availabilityId, ownerId, cookId, ...values })
        .onConflictDoUpdate({
          target: availabilityWeekly.id,
          set: { ...values, deletedAt: null, updatedAt: sql`now()` },
          setWhere: and(
            eq(availabilityWeekly.ownerId, ownerId),
            eq(availabilityWeekly.cookId, cookId),
          ),
        })
        .returning({ id: availabilityWeekly.id });
      if (!written.length) throw new ConflictError("A row with one of these ids already exists");
    }
    for (const id of serviceIds) await replan(tx, ctx, id);
  },
});

// Replaces the date's live override (soft-deleting it) with `overrideId`'s hours; null: not
// available that date; "weekly": back to the weekly hours, so no new row. Under the Cook's lock.
async function writeOverride(
  tx: Tx,
  ownerId: string,
  cookId: string,
  overrideId: string,
  date: string,
  hours: Hours | null | "weekly",
) {
  await tx
    .update(availabilityOverrides)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(availabilityOverrides.cookId, cookId),
        eq(availabilityOverrides.ownerId, ownerId),
        eq(availabilityOverrides.date, date),
        isNull(availabilityOverrides.deletedAt),
      ),
    );
  if (hours === "weekly") return;
  const values = {
    date,
    startTime: hours === null ? null : toTimeColumn(hours.start),
    endTime: hours === null ? null : toTimeColumn(hours.end),
  };
  const written = await tx
    .insert(availabilityOverrides)
    .values({ id: overrideId, ownerId, cookId, ...values })
    .onConflictDoUpdate({
      target: availabilityOverrides.id,
      set: { ...values, deletedAt: null, updatedAt: sql`now()` },
      setWhere: and(
        eq(availabilityOverrides.ownerId, ownerId),
        eq(availabilityOverrides.cookId, cookId),
      ),
    })
    .returning({ id: availabilityOverrides.id });
  if (!written.length) throw new ConflictError("A row with one of these ids already exists");
}

/** One date's hours, or not available that date ("off"), or back to the weekly hours ("weekly"). */
export const setAvailabilityOverride = defineMutator({
  name: "setAvailabilityOverride",
  args: z.strictObject({
    overrideId: z.uuid(),
    date: z.iso.date(),
    availability: z.discriminatedUnion("kind", [
      z
        .strictObject({ kind: z.literal("hours"), start: minuteOfDay, end: endOfDay })
        .refine((h) => h.end > h.start, endAfterStart),
      z.strictObject({ kind: z.literal("off") }),
      z.strictObject({ kind: z.literal("weekly") }),
    ]),
  }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    // Lock order Service, then Cook (D6); every Service follows the Cook's Availability.
    const serviceIds = await lockServices(tx, ownerId, { allServices: true });
    const cookId = await lockCook(tx, ownerId);
    await writeOverride(
      tx,
      ownerId,
      cookId,
      args.overrideId,
      args.date,
      overrideHours(args.availability),
    );
    for (const id of serviceIds) await replan(tx, ctx, id);
  },
});

// setAvailabilityOverride's choice as writeOverride's hours.
function overrideHours(
  a: { kind: "weekly" } | { kind: "off" } | ({ kind: "hours" } & Hours),
): Hours | null | "weekly" {
  if (a.kind === "weekly") return "weekly";
  if (a.kind === "off") return null;
  return a;
}

const owner = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dish"), dishId: z.uuid() }),
  z.strictObject({ kind: z.literal("batch"), batchId: z.uuid() }),
]);

/**
 * "Give the Cook more time" (#90, spec §6.5): the smallest one-date override that places this
 * Unplaced Task and moves no other placement (`smallestOverride`), written as the date's override,
 * then every Service re-planned. Refused, writing nothing, when no such override exists (owner
 * decision 2), including a `WindowTooTight` Task and one that is placed.
 */
export const giveCookMoreTime = defineMutator({
  name: "giveCookMoreTime",
  args: z.strictObject({ serviceId: z.uuid(), owner, firstStepId: z.uuid(), overrideId: z.uuid() }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    // Lock order Service, then Cook (D6), as setAvailabilityOverride.
    const serviceIds = await lockServices(tx, ownerId, { allServices: true });
    const cookId = await lockCook(tx, ownerId);
    if (!serviceIds.includes(args.serviceId)) throw new NotFoundError("Service");
    const rows = await loadPlanRows(
      tx,
      ownerId,
      await findLiveService(tx, ownerId, args.serviceId),
    );
    const proposal = smallestOverride(rows, ctx.timeZone, taskKey(args.owner, args.firstStepId));
    if (!proposal)
      throw new InvalidArgsError("No extra time on one date fits this Task without moving others");
    await writeOverride(tx, ownerId, cookId, args.overrideId, proposal.date, {
      start: proposal.start,
      end: proposal.end,
    });
    await replanAffected(tx, ctx, { allServices: true });
  },
});
