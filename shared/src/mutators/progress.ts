import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { lockService, replan } from "../plan/replan.ts";
import { batches, courses, dishes, stepEvents, steps } from "../schema.ts";
import { defineMutator, NotFoundError, type MutatorContext, type Tx } from "./define.ts";

// Step progress (#88): a tick appends `done`, an untick appends `undone` to the append-only
// `step_events` (ADR 0010: a Step's state is its latest event), then this Service is re-planned.

const owner = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dish"), dishId: z.uuid() }),
  z.strictObject({ kind: z.literal("batch"), batchId: z.uuid() }),
]);
const args = z.strictObject({ eventId: z.uuid(), serviceId: z.uuid(), owner, stepId: z.uuid() });
type Args = z.infer<typeof args>;

// The Step's Recipe, when the owner is live in this Service: a Dish on a live Course of its Menu,
// or one of its live Batches. Anything else, another owner's included, is missing.
async function ownerRecipe(tx: Tx, ownerId: string, menuId: string, args: Args): Promise<string> {
  const { owner: o, serviceId } = args;
  const [row] =
    o.kind === "dish"
      ? await tx
          .select({ recipeId: dishes.recipeId })
          .from(dishes)
          .innerJoin(courses, eq(courses.id, dishes.courseId))
          .where(
            and(
              eq(dishes.id, o.dishId),
              eq(dishes.ownerId, ownerId),
              isNull(dishes.deletedAt),
              eq(courses.menuId, menuId),
              isNull(courses.deletedAt),
            ),
          )
      : await tx
          .select({ recipeId: batches.subRecipeId })
          .from(batches)
          .where(
            and(
              eq(batches.id, o.batchId),
              eq(batches.ownerId, ownerId),
              eq(batches.serviceId, serviceId),
              isNull(batches.deletedAt),
            ),
          );
  if (!row) throw new NotFoundError("Step");
  return row.recipeId;
}

async function appendEvent(tx: Tx, args: Args, ctx: MutatorContext, kind: "done" | "undone") {
  // Lock order Service first (D6), so the latest event below can't change under us.
  const service = await lockService(tx, ctx.ownerId, args.serviceId);
  const recipeId = await ownerRecipe(tx, ctx.ownerId, service.menuId, args);
  const [step] = await tx
    .select({ id: steps.id })
    .from(steps)
    .where(
      and(
        eq(steps.id, args.stepId),
        eq(steps.recipeId, recipeId),
        eq(steps.ownerId, ctx.ownerId),
        isNull(steps.deletedAt),
      ),
    );
  if (!step) throw new NotFoundError("Step");

  const dishId = args.owner.kind === "dish" ? args.owner.dishId : null;
  const batchId = args.owner.kind === "batch" ? args.owner.batchId : null;
  const [latest] = await tx
    .select({ at: stepEvents.at })
    .from(stepEvents)
    .where(
      and(
        eq(stepEvents.serviceId, args.serviceId),
        eq(stepEvents.stepId, args.stepId),
        dishId ? eq(stepEvents.dishId, dishId) : eq(stepEvents.batchId, batchId!),
      ),
    )
    .orderBy(desc(stepEvents.at))
    .limit(1);
  // Strictly after the Step's latest event (D3), so "latest" has one answer on a clock that stands still.
  const at = new Date(Math.max(ctx.now().getTime(), latest ? latest.at.getTime() + 1 : -Infinity));
  // A reused `eventId` is a unique violation: 409 through /mutate.
  await tx.insert(stepEvents).values({
    id: args.eventId,
    ownerId: ctx.ownerId,
    serviceId: args.serviceId,
    dishId,
    batchId,
    stepId: args.stepId,
    kind,
    at,
  });
  await replan(tx, ctx, args.serviceId);
}

/** Ticks a Step done: appends `done`, then re-plans its Service (a late tick moves what follows). */
export const tickStep = defineMutator({
  name: "tickStep",
  args,
  run: (tx, a, ctx) => appendEvent(tx, a, ctx, "done"),
});

/** Unticks a Step: appends `undone`, then re-plans its Service. */
export const untickStep = defineMutator({
  name: "untickStep",
  args,
  run: (tx, a, ctx) => appendEvent(tx, a, ctx, "undone"),
});
