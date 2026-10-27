import { z } from "zod";
import { normaliseName } from "../catalog/match.ts";
import type { RecipeSnapshot, SnapshotStep } from "./snapshot.ts";

// What the Planning pass sets for the scheduler (spec §2). Pure and free of drizzle, so the
// server, the browser and the scheduler (#86) can all run it.

/** The longest make-ahead window, in days before Service. */
export const MAX_BEFORE_DAYS = 30;

/** Whole days: `beforeDays` before Service (0 = on the Service date), kept `shelfLifeDays` once made. */
export const makeAheadSchema = z.strictObject({
  beforeDays: z.int().min(0).max(MAX_BEFORE_DAYS),
  shelfLifeDays: z.int().min(0).max(365),
});
export type MakeAhead = z.infer<typeof makeAheadSchema>;

export type EffectiveMakeAhead = MakeAhead & { from: "step" | "recipe" };

/** A Step's own window, else its Recipe's, else none. A Step's `beforeDays: 0` is its own window. */
export function effectiveMakeAhead(
  step: { makeAhead: MakeAhead | null },
  recipe: { makeAhead: MakeAhead | null },
): EffectiveMakeAhead | null {
  if (step.makeAhead) return { ...step.makeAhead, from: "step" };
  if (recipe.makeAhead) return { ...recipe.makeAhead, from: "recipe" };
  return null;
}

type GroupedStep = { id: string; groupWithPrevious: boolean };

/** One group per Task, Steps in position order. The first Step of a group is its key Step. */
export function stepGroups(steps: GroupedStep[]): { keyStepId: string; stepIds: string[] }[] {
  const groups: { keyStepId: string; stepIds: string[] }[] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    // The first Step has no previous Step, so its flag is ignored.
    if (last && step.groupWithPrevious) last.stepIds.push(step.id);
    else groups.push({ keyStepId: step.id, stepIds: [step.id] });
  }
  return groups;
}

type Link = { beforeStepId: string; afterStepId: string };

/**
 * A cycle in the Task graph that manual finish-to-start links make once grouping is applied, as
 * the Step ids the links pass through, back to the first; or null. A forward link inside one Task
 * is redundant, not a cycle; a backward one is a cycle.
 */
export function findPlanningCycle(steps: GroupedStep[], links: Link[]): string[] | null {
  const taskOf = new Map<string, string>();
  const index = new Map<string, number>();
  for (const group of stepGroups(steps))
    for (const id of group.stepIds) taskOf.set(id, group.keyStepId);
  steps.forEach((step, i) => index.set(step.id, i));

  const out = new Map<string, Link[]>();
  for (const link of links) {
    const from = taskOf.get(link.beforeStepId);
    const to = taskOf.get(link.afterStepId);
    if (from === undefined || to === undefined) continue;
    if (from === to) {
      if (index.get(link.beforeStepId)! < index.get(link.afterStepId)!) continue;
      return pathOf([link]);
    }
    out.set(from, [...(out.get(from) ?? []), link]);
  }

  // Depth-first over Tasks; a link back to a Task on the stack closes a cycle.
  const done = new Set<string>();
  const onStack: string[] = [];
  const stackLinks: Link[] = [];
  const visit = (task: string): string[] | null => {
    onStack.push(task);
    for (const link of out.get(task) ?? []) {
      const next = taskOf.get(link.afterStepId)!;
      const at = onStack.indexOf(next);
      if (at >= 0) return pathOf([...stackLinks.slice(at), link]);
      if (done.has(next)) continue;
      stackLinks.push(link);
      const found = visit(next);
      if (found) return found;
      stackLinks.pop();
    }
    onStack.pop();
    done.add(task);
    return null;
  };
  for (const step of steps) {
    const task = taskOf.get(step.id)!;
    if (done.has(task)) continue;
    const found = visit(task);
    if (found) return found;
  }
  return null;
}

// The Step ids a chain of links passes through, closed back on its first Step.
function pathOf(links: Link[]): string[] {
  const path = [links[0].beforeStepId];
  for (const link of links) {
    if (path.at(-1) !== link.beforeStepId) path.push(link.beforeStepId);
    path.push(link.afterStepId);
  }
  if (path.at(-1) !== path[0]) path.push(path[0]);
  return path;
}

/** A Step's text with each line token read as its line's wording. */
export function stepPlainText(step: SnapshotStep): string {
  const wording = new Map(step.lines.map((l) => [l.id, l.wording ?? ""]));
  return step.body
    .map((t) => (t.type === "text" ? t.text : (wording.get(t.lineId) ?? "")))
    .join("");
}

export type ReadyToPlan = {
  /** Step ids, in Step order, with neither active nor passive time. An explicit 0 counts as set. */
  missingDuration: string[];
  /** A Step whose text repeats a line's preparation ("Dice the shallots" next to "shallots, diced"). */
  duplicates: { stepId: string; lineId: string }[];
};

/** What the scheduler still lacks, and likely duplicates. Only flags; nothing is blocked. */
export function readyToPlan(
  snapshot: RecipeSnapshot,
  ingredientNames: Map<string, string>,
): ReadyToPlan {
  const lines = snapshot.steps.flatMap((s) => s.lines);
  const duplicates: ReadyToPlan["duplicates"] = [];
  for (const step of snapshot.steps) {
    const words = wordsOf(stepPlainText(step));
    const stems = new Set(words.map(stem));
    for (const line of lines) {
      const prepared = wordsOf(line.preparation ?? "").filter((w) => w.endsWith("ed"));
      if (!prepared.some((w) => stems.has(stem(w)))) continue;
      const names = [
        line.wording,
        line.ingredientId ? ingredientNames.get(line.ingredientId) : undefined,
      ];
      if (names.some((name) => name && containsWords(words, wordsOf(name))))
        duplicates.push({ stepId: step.id, lineId: line.id });
    }
  }
  return {
    missingDuration: snapshot.steps
      .filter((s) => s.activeMinutes === null && s.passiveMinutes === null)
      .map((s) => s.id),
    duplicates,
  };
}

// Each word compared the way catalog names are (case, accents, plural).
function wordsOf(text: string): string[] {
  return (text.match(/[\p{L}\p{N}'’]+/gu) ?? []).map(normaliseName);
}

function containsWords(words: string[], name: string[]): boolean {
  if (!name.length) return false;
  return words.some((_, i) => name.every((w, j) => words[i + j] === w));
}

// "diced", "dicing" and "dice" → "dic"; "chopped" and "chop" → "chop". Applied to both sides.
function stem(word: string): string {
  let s = word;
  for (const suffix of ["ing", "ed", "es", "s", "e"]) {
    if (s.endsWith(suffix) && s.length - suffix.length >= 3) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  if (/([^aeiou])\1$/.test(s)) s = s.slice(0, -1);
  return s;
}
