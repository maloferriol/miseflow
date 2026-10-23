import { and, asc, eq, gte, isNull } from "drizzle-orm";
import type { Tx } from "../mutators/define.ts";
import { availabilityOverrides, availabilityWeekly, cooks } from "../schema.ts";
import type { Hours } from "./model.ts";
import { fromTimeColumn, type LocalDate } from "./time.ts";

// Re-plan against the database: read a Service's rows, run the pure scheduler, write the diff.

/**
 * The implicit Cook's id: the owner's id (D1), so one row per owner is guaranteed by the primary
 * key and the browser can compute it too. One atomic insert; an existing row is left untouched.
 */
export async function ensureCook(tx: Tx, ownerId: string): Promise<string> {
  await tx.insert(cooks).values({ id: ownerId, ownerId, name: "Me" }).onConflictDoNothing({ target: cooks.id });
  return ownerId;
}

/** The implicit Cook, row-locked, so Availability saves of one owner run one after another (D10). */
export async function lockCook(tx: Tx, ownerId: string): Promise<string> {
  const cookId = await ensureCook(tx, ownerId);
  await tx.select({ id: cooks.id }).from(cooks).where(and(eq(cooks.id, cookId), eq(cooks.ownerId, ownerId))).for("update");
  return cookId;
}

export type Availability = {
  weekly: ({ id: string; weekday: number } & Hours)[];
  overrides: { id: string; date: LocalDate; hours: Hours | null }[];
};

/** The implicit Cook's live weekly hours and overrides (from `overridesFrom` on, when given), in order. */
export async function loadAvailability(tx: Tx, ownerId: string, overridesFrom?: LocalDate): Promise<Availability> {
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
    .orderBy(asc(availabilityWeekly.weekday), asc(availabilityWeekly.startTime), asc(availabilityWeekly.id));
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
