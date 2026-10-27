import { describe, expect, it } from "vitest";
import { convert } from "./convert.ts";

describe("convert", () => {
  it("turns 750 ml into exactly 0.75 L", () => {
    expect(convert({ value: 750, unit: "ml" }, "L", "metric")).toEqual({
      value: 0.75,
      approximate: false,
    });
  });

  it("turns 2 cups into 500 ml in the metric region and 473.2 ml in the US", () => {
    expect(convert({ value: 2, unit: "cup" }, "ml", "metric")).toEqual({
      value: 500,
      approximate: false,
    });
    expect(convert({ value: 2, unit: "cup" }, "ml", "us")).toEqual({
      value: 473.2,
      approximate: false,
    });
  });

  it("can't turn grams into millilitres with no Conversion", () => {
    expect(convert({ value: 200, unit: "g" }, "ml", "metric")).toBeNull();
  });

  it("marks a reference Conversion ≈ and the kitchen's own one exact", () => {
    expect(
      convert({ value: 2, unit: "cup" }, "g", "metric", () => ({ factor: 125, source: "seed" })),
    ).toEqual({ value: 250, approximate: true });
    expect(
      convert({ value: 2, unit: "cup" }, "g", "metric", () => ({ factor: 125, source: "own" })),
    ).toEqual({ value: 250, approximate: false });
  });

  it("keeps cloves as cloves", () => {
    expect(convert({ value: 3, unit: "clove" }, "clove", "metric")).toEqual({
      value: 3,
      approximate: false,
    });
  });

  it("keeps pieces as pieces", () => {
    expect(convert({ value: 3, unit: null }, null, "metric")).toEqual({
      value: 3,
      approximate: false,
    });
  });
});
