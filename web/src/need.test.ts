import { describe, expect, it } from "vitest";
import type { ShoppingRow } from "./api.ts";
import { needText } from "./need.ts";

const row = (spec: Partial<ShoppingRow>): ShoppingRow => ({
  ingredientId: "id-1",
  name: "flour",
  need: null,
  unit: null,
  approximate: false,
  vague: [],
  unconverted: [],
  got: false,
  ...spec,
});

describe("needText", () => {
  it("writes a total in its Main unit, and pieces without one", () => {
    expect(needText(row({ need: 250, unit: "g" }))).toBe("250 g");
    expect(needText(row({ need: 6, unit: "each" }))).toBe("6");
    expect(needText(row({ need: 2, unit: null }))).toBe("2");
  });

  it("marks an Approximate total", () => {
    expect(needText(row({ need: 250, unit: "g", approximate: true }))).toBe("≈ 250 g");
  });

  it("drops float noise from the text only", () => {
    expect(needText(row({ need: 0.1 * 3 * 1000, unit: "g" }))).toBe("300 g");
  });

  it("joins the total, Vague amounts and parts that need a conversion", () => {
    const text = needText(
      row({ need: 40, unit: "g", vague: ["a pinch"], unconverted: [{ amount: 2, unit: "thumb" }] }),
    );
    expect(text).toBe("40 g + a pinch + 2 thumb ⚠ needs conversion");
  });

  it("writes only the Vague amounts when nothing adds up", () => {
    expect(needText(row({ vague: ["a pinch", "to taste"] }))).toBe("a pinch + to taste");
  });
});
