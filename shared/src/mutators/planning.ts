import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  findPlanningCycle,
  makeAheadSchema,
  stepPlainText,
} from "../recipe/planning.ts";
import { loadRecipeSnapshot, type RecipeSnapshot } from "../recipe/snapshot.ts";
import { recipes, stepDependencies, steps } from "../schema.ts";
import {
  ConflictError,
  defineMutator,
  InvalidArgsError,
  NotFoundError,
  type Tx,
} from "./define.ts";
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

export const setGroupWithPrevious = defineMutator({
  name: "setGroupWithPrevious",
  args: z.strictObject({
    stepId: z.uuid(),
    revisionId: z.uuid(),
    value: z.boolean(),
  }),
  async run(tx, args, { ownerId }) {
    const step = await lockStep(tx, ownerId, args.stepId);
    if (args.value) {
      const snapshot = await loadRecipeSnapshot(tx, ownerId, step.recipeId);
      if (snapshot.steps[0]?.id === args.stepId)
        throw new InvalidArgsError(
          "The first Step has no previous Step to group with",
        );
      const grouped = snapshot.steps.map((s) =>
        s.id === args.stepId ? { ...s, groupWithPrevious: true } : s,
      );
      refuseCycle({ ...snapshot, steps: grouped }, snapshot.dependencies);
    }
    await tx
      .update(steps)
      .set({ groupWithPrevious: args.value, updatedAt: sql`now()` })
      .where(eq(steps.id, args.stepId));
    await appendRevision(tx, ownerId, step.recipeId, args.revisionId);
  },
});

/** A manual finish-to-start link: `beforeStepId` finishes before `afterStepId` starts. */
export const addStepDependency = defineMutator({
  name: "addStepDependency",
  args: z.strictObject({
    dependencyId: z.uuid(),
    revisionId: z.uuid(),
    beforeStepId: z.uuid(),
    afterStepId: z.uuid(),
  }),
  async run(tx, args, { ownerId }) {
    // Compared before any lock, so only the one Recipe is ever locked.
    const [before, after] = await liveSteps(tx, ownerId, args);
    if (before.recipeId !== after.recipeId)
      throw new InvalidArgsError("A dependency links Steps of one Recipe");
    const recipeId = before.recipeId;
    await lockRecipe(tx, ownerId, recipeId);
    // Read again under the lock: a concurrent removeStep may have committed in between.
    await liveSteps(tx, ownerId, args);

    const snapshot = await loadRecipeSnapshot(tx, ownerId, recipeId);
    const live = snapshot.dependencies;
    if (
      live.some(
        (d) =>
          d.beforeStepId === args.beforeStepId &&
          d.afterStepId === args.afterStepId,
      )
    )
      throw new ConflictError("These Steps are already linked");
    refuseCycle(snapshot, [...live, args]);

    // The pair is unique across soft-deleted rows too, so a removed pair comes back with its old
    // id. Source: https://orm.drizzle.team/docs/insert#on-conflict-do-update (composite target, setWhere)
    const written = await tx
      .insert(stepDependencies)
      .values({
        id: args.dependencyId,
        ownerId,
        recipeId,
        beforeStepId: args.beforeStepId,
        afterStepId: args.afterStepId,
      })
      .onConflictDoUpdate({
        target: [stepDependencies.beforeStepId, stepDependencies.afterStepId],
        set: { deletedAt: null, updatedAt: sql`now()` },
        setWhere: eq(stepDependencies.ownerId, ownerId),
      })
      .returning({ id: stepDependencies.id });
    if (!written.length) throw new ConflictError("These Steps are already linked");
    await appendRevision(tx, ownerId, recipeId, args.revisionId);
  },
});

export const removeStepDependency = defineMutator({
  name: "removeStepDependency",
  args: z.strictObject({ dependencyId: z.uuid(), revisionId: z.uuid() }),
  async run(tx, args, { ownerId }) {
    const find = () =>
      tx
        .select({ recipeId: stepDependencies.recipeId })
        .from(stepDependencies)
        .where(
          and(
            eq(stepDependencies.id, args.dependencyId),
            eq(stepDependencies.ownerId, ownerId),
            isNull(stepDependencies.deletedAt),
          ),
        );
    const [dependency] = await find();
    if (!dependency) throw new NotFoundError("Dependency");
    await lockRecipe(tx, ownerId, dependency.recipeId);
    if (!(await find()).length) throw new NotFoundError("Dependency");
    await tx
      .update(stepDependencies)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(stepDependencies.id, args.dependencyId));
    await appendRevision(tx, ownerId, dependency.recipeId, args.revisionId);
  },
});

// Both Steps of a link, each the caller's and live.
async function liveSteps(
  tx: Tx,
  ownerId: string,
  link: { beforeStepId: string; afterStepId: string },
) {
  const find = async (id: string) => {
    const [step] = await tx
      .select({ id: steps.id, recipeId: steps.recipeId })
      .from(steps)
      .where(
        and(eq(steps.id, id), eq(steps.ownerId, ownerId), isNull(steps.deletedAt)),
      );
    if (!step) throw new NotFoundError("Step");
    return step;
  };
  return [await find(link.beforeStepId), await find(link.afterStepId)] as const;
}

// Refuses links and grouping that would make a cycle between Tasks, naming the Steps around it.
function refuseCycle(
  snapshot: RecipeSnapshot,
  links: { beforeStepId: string; afterStepId: string }[],
) {
  const cycle = findPlanningCycle(snapshot.steps, links);
  if (!cycle) return;
  const text = new Map(snapshot.steps.map((s) => [s.id, label(stepPlainText(s))]));
  throw new InvalidArgsError(
    `This would make a cycle: ${cycle.map((id) => text.get(id)).join(" → ")}`,
  );
}

const label = (text: string) => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
};
