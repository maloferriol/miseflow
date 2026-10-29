import { describe, expect, it } from "vitest";
import { createIntent } from "./intent.ts";
import { gotSave, missingText, rowChecked } from "./shopping-list.ts";

describe("gotSave", () => {
  it("marks a row Got with markGot, with a mark id of its own", () => {
    const call = gotSave("s-1", "butter", true, createIntent());
    expect(call.name).toBe("markGot");
    expect(call.args).toEqual({
      markId: expect.any(String),
      serviceId: "s-1",
      ingredientId: "butter",
    });
    expect(call.args.markId).not.toBe(call.id);
  });

  it("un-marks a row with unmarkGot, which names no mark", () => {
    const call = gotSave("s-1", "butter", false, createIntent());
    expect(call.name).toBe("unmarkGot");
    expect(call.args).toEqual({ serviceId: "s-1", ingredientId: "butter" });
  });

  it("keeps a tick's ids for its retry, and starts fresh ones for the other state", () => {
    const intent = createIntent();
    const got = gotSave("s-1", "butter", true, intent);
    expect(gotSave("s-1", "butter", true, intent)).toEqual(got);
    const unGot = gotSave("s-1", "butter", false, intent);
    expect(unGot.id).not.toBe(got.id);
    expect(gotSave("s-1", "butter", true, intent).id).not.toBe(got.id);
  });

  it("starts fresh ids for another row", () => {
    const intent = createIntent();
    const butter = gotSave("s-1", "butter", true, intent);
    expect(gotSave("s-1", "apple", true, intent).id).not.toBe(butter.id);
  });
});

describe("rowChecked", () => {
  it("shows the saved state while no tick is on its way", () => {
    expect(rowChecked(null, true)).toBe(true);
    expect(rowChecked(null, false)).toBe(false);
  });

  it("shows the state the cook just set over the saved one", () => {
    expect(rowChecked(true, false)).toBe(true);
    expect(rowChecked(false, true)).toBe(false);
  });
});

describe("missingText", () => {
  it("names the Recipe and the line's wording", () => {
    expect(missingText({ lineId: "l-1", recipeName: "Velouté", wording: "chicken stock" })).toBe(
      "Velouté: chicken stock is a Missing sub-recipe and adds nothing to this list",
    );
  });

  it("calls a line with no wording a sub-recipe", () => {
    expect(missingText({ lineId: "l-1", recipeName: "Velouté", wording: null })).toBe(
      "Velouté: a sub-recipe is a Missing sub-recipe and adds nothing to this list",
    );
  });
});
