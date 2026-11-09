import { and, asc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import type { Tx } from "../mutators/define.ts";
import type { Hours } from "../plan/model.ts";
import { fromTimeColumn, type LocalDate } from "../plan/time.ts";
import { availabilityOverrides, availabilityWeekly, cooks, kitchenSettings } from "../schema.ts";

// The implicit Cook, its Availability and the kitchen's default Service time, read from the database.

/**
 * The implicit Cook's id: the owner's id (D1), so one row per owner is guaranteed by the primary
 * key and the browser can compute it too. One atomic insert; an existing row is left untouched.
 */
export async function ensureCook(tx: Tx, ownerId: string): Promise<string> {
  await tx
    .insert(cooks)
    .values({ id: ownerId, ownerId, name: "Me" })
    .onConflictDoNothing({ target: cooks.id });
  return ownerId;
}

export type Availability = {
  weekly: ({ id: string; weekday: number } & Hours)[];
  overrides: { id: string; date: LocalDate; hours: Hours | null }[];
};

/** The implicit Cook's live weekly hours and overrides (from `overridesFrom` on, when given), in order. */
export async function loadAvailability(
  tx: Tx,
  ownerId: string,
  overridesFrom?: LocalDate,
): Promise<Availability> {
  const weekly = await tx
    .select({
      id: availabilityWeekly.id,
      weekday: availabilityWeekly.weekday,
      startTime: availabilityWeekly.startTime,
      endTime: availabilityWeekly.endTime,
    })
    .from(availabilityWeekly)
    .where(
      and(
        eq(availabilityWeekly.cookId, ownerId),
        eq(availabilityWeekly.ownerId, ownerId),
        isNull(availabilityWeekly.deletedAt),
      ),
    )
    .orderBy(
      asc(availabilityWeekly.weekday),
      asc(availabilityWeekly.startTime),
      asc(availabilityWeekly.id),
    );
  const overrides = await tx
    .select({
      id: availabilityOverrides.id,
      date: availabilityOverrides.date,
      startTime: availabilityOverrides.startTime,
      endTime: availabilityOverrides.endTime,
    })
    .from(availabilityOverrides)
    .where(
      and(
        eq(availabilityOverrides.cookId, ownerId),
        eq(availabilityOverrides.ownerId, ownerId),
        isNull(availabilityOverrides.deletedAt),
        ...(overridesFrom ? [gte(availabilityOverrides.date, overridesFrom)] : []),
      ),
    )
    .orderBy(asc(availabilityOverrides.date), asc(availabilityOverrides.id));
  return {
    weekly: weekly.map((w) => ({
      id: w.id,
      weekday: w.weekday,
      start: fromTimeColumn(w.startTime),
      end: fromTimeColumn(w.endTime),
    })),
    overrides: overrides.map((o) => ({
      id: o.id,
      date: o.date,
      hours:
        o.startTime === null || o.endTime === null
          ? null
          : { start: fromTimeColumn(o.startTime), end: fromTimeColumn(o.endTime) },
    })),
  };
}

/** With no setting, the default Service time is 19:00 (D8, spec §3's example). */
export const BUILT_IN_SERVICE_TIME = 19 * 60;

/** The kitchen's default Service time, and whether it is the built-in one. */
export async function loadDefaultServiceTime(
  tx: Tx,
  ownerId: string,
): Promise<{ minuteOfDay: number; builtIn: boolean }> {
  const [row] = await tx
    .select({ time: kitchenSettings.defaultServiceTime })
    .from(kitchenSettings)
    .where(
      and(
        eq(kitchenSettings.ownerId, ownerId),
        isNull(kitchenSettings.deletedAt),
        isNotNull(kitchenSettings.defaultServiceTime),
      ),
    )
    .orderBy(asc(kitchenSettings.id))
    .limit(1);
  return row?.time
    ? { minuteOfDay: fromTimeColumn(row.time), builtIn: false }
    : { minuteOfDay: BUILT_IN_SERVICE_TIME, builtIn: true };
}
