import { describe, expect, it } from "vitest";
import { createIntent } from "./intent.ts";
import { type MutationCall, revisionCall } from "./mutation-call.ts";

describe("MutationCall", () => {
  it("names only a mutation the server registers", () => {
    const known: MutationCall = { id: "m", name: "addCourse", args: {} };
    // @ts-expect-error -- "addCoarse" is not a named mutation (ADR 0007).
    const unknown: MutationCall = { id: "m", name: "addCoarse", args: {} };
    expect([known.name, unknown.name]).toEqual(["addCourse", "addCoarse"]);
  });

  it("types a keyed call's name the same way", () => {
    const intent = createIntent();
    expect(revisionCall("editRecipe", {}, intent).name).toBe("editRecipe");
    // @ts-expect-error -- "editRecipes" is not a named mutation.
    expect(revisionCall("editRecipes", {}, intent).name).toBe("editRecipes");
  });
});
