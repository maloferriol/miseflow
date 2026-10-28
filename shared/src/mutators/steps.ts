import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { replanAffected } from "../plan/replan.ts";
import { isValidQuantity, parseQuantity } from "../recipe/quantity.ts";
import { stepBodySchema, type StepToken } from "../recipe/tokens.ts";
import { ingredientLines, ingredients, stepDependencies, steps } from "../schema.ts";
import {
  ConflictError,
  defineMutator,
  InvalidArgsError,
  NotFoundError,
  type Tx,
} from "./define.ts";
import { positionAfter, positionBetween } from "./position.ts";
import { appendRevision, lockRecipe, lockStep } from "./revision.ts";
import { requireSubRecipeLinks } from "./subrecipes.ts";

// One Ingredient line as the editor sends it. A line is saved only once it links to exactly one
// Ingredient (ADR 0002) or one Recipe used as a sub-recipe (#84). `amount` is the shorthand
// parseQuantity reads.
const lineInput = z
  .strictObject({
    lineId: z.uuid(),
    ingredientId: z.uuid().optional(),
    subRecipeId: z.uuid().optional(),
    amount: z
      .string()
      .max(100)
      .refine((amount) => isValidQuantity(parseQuantity(amount)), {
        message:
          "An amount can't be zero, divide by zero, be a number like 1,000 or have a range whose end is below its start",
      }),
    // The characters that delimit a ref in the shorthand can't be part of its name.
    wording: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^@{}()\n]+$/, "A name can't contain @ { } ( ) or a line break"),
    preparation: z
      .string()
      .trim()
      .max(200)
      .regex(/^[^()\n]*$/, "A preparation can't contain ( ) or a line break")
      .nullable()
      .optional(),
  })
  .refine((line) => (line.ingredientId === undefined) !== (line.subRecipeId === undefined), {
    message: "A line links to exactly one Ingredient or sub-recipe",
  });
type LineInput = z.infer<typeof lineInput>;

// Every line token has its line, every line has one token, and the Step isn't blank.
const content = { body: stepBodySchema, lines: z.array(lineInput).max(200) };
function contentFits({ body, lines }: { body: StepToken[]; lines: LineInput[] }) {
  const tokenIds = body.flatMap((t) => (t.type === "line" ? [t.lineId] : []));
  const lineIds = lines.map((l) => l.lineId);
  const sameIds =
    new Set(tokenIds).size === tokenIds.length &&
    new Set(lineIds).size === lineIds.length &&
    tokenIds.length === lineIds.length &&
    tokenIds.every((id) => lineIds.includes(id));
  const blank = !body.some((t) => t.type === "line" || t.text.trim() !== "");
  return sameIds && !blank;
}
const contentMessage = {
  message: "Each line token needs exactly one line, each line one token, and a Step can't be blank",
};

export const addStep = defineMutator({
  name: "addStep",
  args: z
    .strictObject({
      recipeId: z.uuid(),
      stepId: z.uuid(),
      revisionId: z.uuid(),
      // Omitted: append. Null: first.
      afterStepId: z.uuid().nullable().optional(),
      ...content,
    })
    .refine(contentFits, contentMessage),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    await lockRecipe(tx, ownerId, args.recipeId);
    const live = await liveSteps(tx, ownerId, args.recipeId);
    const position =
      args.afterStepId === undefined
        ? positionBetween(live.at(-1)?.position ?? null, null)
        : slotAfter(live, args.afterStepId);
    await tx.insert(steps).values({
      id: args.stepId,
      ownerId,
      recipeId: args.recipeId,
      position,
      body: args.body,
    });
    await writeLines(tx, ownerId, args.recipeId, args.stepId, args.body, args.lines);
    await appendRevision(tx, ownerId, args.recipeId, args.revisionId);
    await replanAffected(tx, ctx, { recipeId: args.recipeId });
  },
});

/** Replaces the Step's text and lines; the Step and every kept line keep their ids. */
export const editStep = defineMutator({
  name: "editStep",
  args: z
    .strictObject({ stepId: z.uuid(), revisionId: z.uuid(), ...content })
    .refine(contentFits, contentMessage),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    const step = await lockStep(tx, ownerId, args.stepId);
    await tx
      .update(steps)
      .set({ body: args.body, updatedAt: sql`now()` })
      .where(eq(steps.id, args.stepId));
    await writeLines(tx, ownerId, step.recipeId, args.stepId, args.body, args.lines);
    await appendRevision(tx, ownerId, step.recipeId, args.revisionId);
    await replanAffected(tx, ctx, { recipeId: step.recipeId });
  },
});

export const moveStep = defineMutator({
  name: "moveStep",
  // Null: first.
  args: z.strictObject({
    stepId: z.uuid(),
    revisionId: z.uuid(),
    afterStepId: z.uuid().nullable(),
  }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    if (args.afterStepId === args.stepId)
      throw new InvalidArgsError("A Step can't move after itself");
    const step = await lockStep(tx, ownerId, args.stepId);
    const live = await liveSteps(tx, ownerId, step.recipeId);
    const others = live.filter((s) => s.id !== args.stepId);
    const position = slotAfter(others, args.afterStepId);
    await tx
      .update(steps)
      .set({ position, updatedAt: sql`now()` })
      .where(eq(steps.id, args.stepId));
    // No Step silently joins a different Task: the moved Step leaves its group, its follower
    // leaves too if the moved Step was the key Step, and the Step after the new slot doesn't join it.
    const nextAtSlot =
      args.afterStepId === null
        ? others[0]
        : others[others.findIndex((s) => s.id === args.afterStepId) + 1];
    await ungroup(tx, [
      args.stepId,
      ...followerOfKeyStep(live, args.stepId),
      ...(nextAtSlot ? [nextAtSlot.id] : []),
    ]);
    await appendRevision(tx, ownerId, step.recipeId, args.revisionId);
    await replanAffected(tx, ctx, { recipeId: step.recipeId });
  },
});

export const removeStep = defineMutator({
  name: "removeStep",
  args: z.strictObject({ stepId: z.uuid(), revisionId: z.uuid() }),
  async run(tx, args, ctx) {
    const { ownerId } = ctx;
    const step = await lockStep(tx, ownerId, args.stepId);
    const live = await liveSteps(tx, ownerId, step.recipeId);
    await ungroup(tx, followerOfKeyStep(live, args.stepId));
    await tx
      .update(stepDependencies)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          or(
            eq(stepDependencies.beforeStepId, args.stepId),
            eq(stepDependencies.afterStepId, args.stepId),
          ),
          isNull(stepDependencies.deletedAt),
        ),
      );
    await tx
      .update(ingredientLines)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(ingredientLines.stepId, args.stepId), isNull(ingredientLines.deletedAt)));
    await tx
      .update(steps)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(steps.id, args.stepId));
    await appendRevision(tx, ownerId, step.recipeId, args.revisionId);
    await replanAffected(tx, ctx, { recipeId: step.recipeId });
  },
});

async function liveSteps(tx: Tx, ownerId: string, recipeId: string) {
  return tx
    .select({
      id: steps.id,
      position: steps.position,
      groupWithPrevious: steps.groupWithPrevious,
    })
    .from(steps)
    .where(and(eq(steps.recipeId, recipeId), eq(steps.ownerId, ownerId), isNull(steps.deletedAt)))
    .orderBy(asc(sql`${steps.position} collate "C"`), asc(steps.id));
}

// The Step after `stepId`, if `stepId` is a group's key Step: without it, that Step would join the
// previous group.
function followerOfKeyStep(ordered: { id: string; groupWithPrevious: boolean }[], stepId: string) {
  const index = ordered.findIndex((s) => s.id === stepId);
  const isKey = index === 0 || !ordered[index].groupWithPrevious;
  const follower = ordered[index + 1];
  return isKey && follower ? [follower.id] : [];
}

async function ungroup(tx: Tx, stepIds: string[]) {
  if (!stepIds.length) return;
  await tx
    .update(steps)
    .set({ groupWithPrevious: false, updatedAt: sql`now()` })
    .where(and(inArray(steps.id, stepIds), eq(steps.groupWithPrevious, true)));
}

// The position right after `afterStepId` (null: before the first), among `ordered` live Steps.
function slotAfter(ordered: { id: string; position: string }[], afterStepId: string | null) {
  if (afterStepId === null) return positionBetween(null, ordered[0]?.position ?? null);
  const index = ordered.findIndex((s) => s.id === afterStepId);
  if (index < 0) throw new NotFoundError("Step");
  return positionBetween(ordered[index].position, ordered[index + 1]?.position ?? null);
}

// Inserts new lines, updates kept ones and soft-deletes the Step's lines that are gone.
async function writeLines(
  tx: Tx,
  ownerId: string,
  recipeId: string,
  stepId: string,
  body: StepToken[],
  lines: LineInput[],
) {
  await requireVisibleIngredients(
    tx,
    ownerId,
    lines.flatMap((l) => (l.ingredientId ? [l.ingredientId] : [])),
  );
  await requireSubRecipeLinks(
    tx,
    ownerId,
    recipeId,
    lines.flatMap((l) => (l.subRecipeId ? [l.subRecipeId] : [])),
  );
  const lineIds = lines.map((l) => l.lineId);

  await tx
    .update(ingredientLines)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(ingredientLines.stepId, stepId),
        isNull(ingredientLines.deletedAt),
        ...(lineIds.length ? [notInArray(ingredientLines.id, lineIds)] : []),
      ),
    );

  // Lines are ordered as their tokens are.
  const byId = new Map(lines.map((l) => [l.lineId, l]));
  let position: string | null = null;
  for (const token of body) {
    if (token.type !== "line") continue;
    const line = byId.get(token.lineId)!;
    position = positionAfter(position);
    const q = parseQuantity(line.amount);
    const values = {
      ingredientId: line.ingredientId ?? null,
      subRecipeId: line.subRecipeId ?? null,
      quantity: q.value === null ? null : String(q.value),
      quantityMax: q.max === null ? null : String(q.max),
      unit: q.unit,
      wording: line.wording,
      preparation: line.preparation || null,
      fixedQuantity: q.fixedQuantity,
      position,
    };
    // A lineId may only ever be this Step's own line. The guard sits on the upsert itself, so a
    // concurrent insert of the same id by another Step or owner can't be overwritten.
    // Source: https://orm.drizzle.team/docs/insert#on-conflict-do-update (setWhere)
    const written = await tx
      .insert(ingredientLines)
      .values({ id: line.lineId, ownerId, stepId, ...values })
      .onConflictDoUpdate({
        target: ingredientLines.id,
        set: { ...values, updatedAt: sql`now()`, deletedAt: null },
        setWhere: and(eq(ingredientLines.stepId, stepId), eq(ingredientLines.ownerId, ownerId)),
      })
      .returning({ id: ingredientLines.id });
    if (!written.length)
      throw new ConflictError("An Ingredient line already belongs to another Step");
  }
}

// Each Ingredient must be a seed one or the caller's own live one; anything else reads as missing.
async function requireVisibleIngredients(tx: Tx, ownerId: string, ids: string[]) {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return;
  const rows = await tx
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(
      and(
        inArray(ingredients.id, wanted),
        or(
          and(isNull(ingredients.ownerId), eq(ingredients.source, "seed")),
          eq(ingredients.ownerId, ownerId),
        ),
        isNull(ingredients.deletedAt),
      ),
    );
  if (rows.length !== wanted.length) throw new NotFoundError("Ingredient");
}
