import { describe, expect, it } from "vitest";
import { recipeName } from "./recipes-screen.ts";

describe("recipeName", () => {
  it("trims the name the cook typed", () => {
    expect(recipeName("  Velouté ")).toBe("Velouté");
  });

  it("is null for a blank name", () => {
    expect(recipeName("")).toBeNull();
    expect(recipeName("   ")).toBeNull();
  });
});
