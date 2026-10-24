import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { MAX_BEFORE_DAYS } from "../recipe/planning.ts";
import { loadDefaultServiceTime, lockService, replan } from "../plan/replan.ts";
import { addDays, fromTimeColumn, zonedMinute } from "../plan/time.ts";
import { taskPlacements } from "../schema.ts";
import { defineMutator, InvalidArgsError, NotFoundError } from "./define.ts";

// Pins (#89, CONTEXT Pin): moving a Task on the Gantt chart pins it there, then the Service is
// re-planned around it in the same transaction. No Availability check: a pin outside it stays.

const owner = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dish"), dishId: z.uuid() }),
  z.strictObject({ kind: z.literal("batch"), batchId: z.uuid() }),
]);

/** Moves a placed Task to `start` (on the 5-minute grid) and pins it, then re-plans its Service. */
export const pinTask = defineMutator({
  name: "pinTask",
  args: z.strictObject({ serviceId: z.uuid(), owner, firstStepId: z.uuid(), start: z.int().multipleOf(5) }),
  async run(tx, args, ctx) {
    // FOR NO KEY UPDATE on the Service (D6), before the placement row, as every re-plan does.
    const service = await lockService(tx, ctx.ownerId, args.serviceId);
    // A pin falls between the start of the day before the earliest make-ahead date can be and the
    // Service itself; nights and dates without Availability inside that are allowed.
    const time = service.time === null ? (await loadDefaultServiceTime(tx, ctx.ownerId)).minuteOfDay : fromTimeColumn(service.time);
    const latest = zonedMinute(service.date, time, ctx.timeZone);
    const earliest = zonedMinute(addDays(service.date, -(MAX_BEFORE_DAYS + 1)), 0, ctx.timeZone);
    if (args.start < earliest || args.start > latest) throw new InvalidArgsError("A pin must fall between a month before the Service and the Service");
    const o = args.owner;
    // The Task's live placement in this Service: an Unplaced Task, or one of another Service, has none.
    const [row] = await tx
      .select({ id: taskPlacements.id })
      .from(taskPlacements)
      .where(
        and(
          eq(taskPlacements.serviceId, args.serviceId),
          eq(taskPlacements.ownerId, ctx.ownerId),
          o.kind === "dish" ? eq(taskPlacements.dishId, o.dishId) : eq(taskPlacements.batchId, o.batchId),
          eq(taskPlacements.firstStepId, args.firstStepId),
          isNull(taskPlacements.deletedAt),
        ),
      );
    if (!row) throw new NotFoundError("Task");
    await tx
      .update(taskPlacements)
      .set({ startMinute: args.start, pinned: true, updatedAt: sql`now()` })
      .where(eq(taskPlacements.id, row.id));
    await replan(tx, ctx, args.serviceId);
  },
});
