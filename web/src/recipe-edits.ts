import { createIntent, retryable } from "./intent.ts";
import type { Send } from "./step-links.ts";

/**
 * The Recipe screen's edits, each with its own retry intent: a retry after a lost response
 * replays, and one edit going through doesn't drop another's pending ids (#127 C).
 */
export function recipeEdits(recipeId: string, send: Send) {
  return {
    editRecipe: retryable(createIntent(), (args: { name: string; servings: number | null }, id) =>
      send({
        id: id("mutation"),
        name: "editRecipe",
        args: { recipeId, revisionId: id("revision"), ...args },
      }),
    ),
    moveStep: retryable(
      createIntent(),
      (args: { stepId: string; afterStepId: string | null }, id) =>
        send({
          id: id("mutation"),
          name: "moveStep",
          args: { revisionId: id("revision"), ...args },
        }),
    ),
    removeStep: retryable(createIntent(), (stepId: string, id) =>
      send({
        id: id("mutation"),
        name: "removeStep",
        args: { stepId, revisionId: id("revision") },
      }),
    ),
  };
}
