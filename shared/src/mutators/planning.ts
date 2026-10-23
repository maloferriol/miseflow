import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { makeAheadSchema } from "../recipe/planning.ts";
import { recipes, steps } from "../schema.ts";
import { defineMutator } from "./define.ts";
import { appendRevision, lockRecipe, lockStep } from "./revision.ts";

// The Planning pass (spec §2): what the scheduler needs, each change one named mutation that
// appends one Revision. #86 adds its re-plan call here.

// Whole minutes, up to a week. Null: not set; both null is "missing a duration".
const minutes = z.int().min(0).max(10080).nullable();

export const setStepTimes = defineMutator({
  name: "setStepTimes",
  args: z.strictObject({
    stepId: z.uuid(),
    revisionId: z.uuid(),
    activeMinutes: minutes,
    passiveMinutes: minutes,
  }),
  async run(tx, args, { ownerId }) {
    const step = await lockStep(tx, ownerId, args.stepId);
    await tx
      .update(steps)
      .set({
        activeMinutes: args.activeMinutes,
        passiveMinutes: args.passiveMinutes,
        updatedAt: sql`now()`,
      })
      .where(eq(steps.id, args.stepId));
    await appendRevision(tx, ownerId, step.recipeId, args.revisionId);
  },
});

/** A Recipe's null window is none; a Step's null window inherits its Recipe's. */
export const setMakeAhead = defineMutator({
  name: "setMakeAhead",
  args: z.strictObject({
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("recipe"), recipeId: z.uuid() }),
      z.strictObject({ kind: z.literal("step"), stepId: z.uuid() }),
    ]),
    revisionId: z.uuid(),
    window: makeAheadSchema.nullable(),
  }),
  async run(tx, args, { ownerId }) {
    const values = {
      makeAheadBeforeDays: args.window?.beforeDays ?? null,
      shelfLifeDays: args.window?.shelfLifeDays ?? null,
      updatedAt: sql`now()`,
    };
    let recipeId: string;
    if (args.target.kind === "recipe") {
      recipeId = args.target.recipeId;
      await lockRecipe(tx, ownerId, recipeId);
      await tx.update(recipes).set(values).where(eq(recipes.id, recipeId));
    } else {
      recipeId = (await lockStep(tx, ownerId, args.target.stepId)).recipeId;
      await tx
        .update(steps)
        .set(values)
        .where(eq(steps.id, args.target.stepId));
    }
    await appendRevision(tx, ownerId, recipeId, args.revisionId);
  },
});
