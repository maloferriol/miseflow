import { describe, expect, it } from "vitest";
import { recipeEdits } from "./recipe-edits.ts";

// A /mutate that records what was sent, losing the first response after "applying" it.
function server() {
  const sent: { id: string; name: string; args: Record<string, unknown> }[] = [];
  let lose = true;
  const send = (id: string, name: string, args: Record<string, unknown>) => {
    sent.push({ id, name, args });
    if (!lose) return Promise.resolve();
    lose = false;
    return Promise.reject(new Error("Failed to fetch"));
  };
  return { send, sent };
}

describe("recipeEdits", () => {
  it("sends each edit with the Recipe's id and a Revision id", async () => {
    const { send, sent } = server();
    const edits = recipeEdits("recipe-1", send);

    await expect(edits.editRecipe({ name: "Sauce", servings: 4 })).rejects.toThrow();
    await edits.moveStep({ stepId: "step-2", afterStepId: null });
    await edits.removeStep("step-3");

    expect(sent).toMatchObject([
      { name: "editRecipe", args: { recipeId: "recipe-1", name: "Sauce", servings: 4 } },
      { name: "moveStep", args: { stepId: "step-2", afterStepId: null } },
      { name: "removeStep", args: { stepId: "step-3" } },
    ]);
    expect(new Set(sent.map((m) => m.args.revisionId)).size).toBe(3);
  });

  it("keeps a lost edit's ids while another edit goes through, so its retry replays", async () => {
    const { send, sent } = server();
    const edits = recipeEdits("recipe-1", send);

    await expect(edits.editRecipe({ name: "Sauce", servings: 4 })).rejects.toThrow();
    await edits.removeStep("step-3");
    await edits.editRecipe({ name: "Sauce", servings: 4 });

    expect(sent[2]).toEqual(sent[0]);
  });
});
