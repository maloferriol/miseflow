import { describe, expect, it } from "vitest";
import { formatQuantity, isValidQuantity, parseQuantity } from "./quantity.ts";

describe("parseQuantity", () => {
  it('parses "1 1/2 cups" as 1.5 cup, a Fixed unit', () => {
    expect(parseQuantity("1 1/2 cups")).toEqual({
      value: 1.5,
      max: null,
      unit: "cup",
      tier: "fixed",
      fixed: false,
    });
  });

  it('parses "200 g" as 200 g, a Fixed unit', () => {
    expect(parseQuantity("200 g")).toEqual({
      value: 200,
      max: null,
      unit: "g",
      tier: "fixed",
      fixed: false,
    });
  });

  it('parses "2-3" and "2–3" as a range of pieces', () => {
    const range = { value: 2, max: 3, unit: null, tier: "ingredient", fixed: false };
    expect(parseQuantity("2-3")).toEqual(range);
    expect(parseQuantity("2–3")).toEqual(range);
  });

  it('parses "3" as 3 pieces, an Ingredient unit', () => {
    expect(parseQuantity("3")).toEqual({
      value: 3,
      max: null,
      unit: null,
      tier: "ingredient",
      fixed: false,
    });
  });

  it('parses "1 clove" as an Ingredient unit', () => {
    expect(parseQuantity("1 clove")).toEqual({
      value: 1,
      max: null,
      unit: "clove",
      tier: "ingredient",
      fixed: false,
    });
  });

  it('parses "a pinch" as a Vague amount', () => {
    expect(parseQuantity("a pinch")).toEqual({
      value: null,
      max: null,
      unit: "pinch",
      tier: "vague",
      fixed: false,
    });
  });

  it("parses an empty amount as a Vague amount", () => {
    expect(parseQuantity("")).toEqual({
      value: null,
      max: null,
      unit: null,
      tier: "vague",
      fixed: false,
    });
  });

  it('sets the Fixed flag from a leading "=" ("=1%tsp")', () => {
    expect(parseQuantity("=1%tsp")).toEqual({
      value: 1,
      max: null,
      unit: "tsp",
      tier: "fixed",
      fixed: true,
    });
  });

  it('reads the Cooklang form "30%g"', () => {
    expect(parseQuantity("30%g")).toMatchObject({ value: 30, unit: "g", tier: "fixed" });
  });

  it('reads Unicode fractions ("½", "1½")', () => {
    expect(parseQuantity("½")).toMatchObject({ value: 0.5, unit: null });
    expect(parseQuantity("1½ tbsp")).toMatchObject({ value: 1.5, unit: "tbsp" });
  });

  it('keeps an unrecognised unit raw ("2 knobs")', () => {
    expect(parseQuantity("2 knobs")).toEqual({
      value: 2,
      max: null,
      unit: "knobs",
      tier: "unknown",
      fixed: false,
    });
  });

  it('matches case only for single letters: "T" is tbsp, "t" is tsp; "oz" is mass, "fl oz" volume', () => {
    expect(parseQuantity("1 T").unit).toBe("tbsp");
    expect(parseQuantity("1 t").unit).toBe("tsp");
    expect(parseQuantity("2 Tbsp").unit).toBe("tbsp");
    expect(parseQuantity("3 c.").unit).toBe("cup");
    expect(parseQuantity("4 oz").unit).toBe("oz");
    expect(parseQuantity("4 fl oz").unit).toBe("fl oz");
  });
});

describe("formatQuantity", () => {
  it.each(["1 1/2 cups", "200 g", "2-3", "3", "1 clove", "a pinch", "", "=1%tsp", "2 knobs"])(
    'round-trips "%s"',
    (text) => {
      const quantity = parseQuantity(text);
      expect(parseQuantity(formatQuantity(quantity))).toEqual(quantity);
    },
  );

  it("writes the Cooklang shorthand", () => {
    expect(formatQuantity(parseQuantity("1 1/2 cups"))).toBe("1.5%cup");
    expect(formatQuantity(parseQuantity("=2-3 cloves"))).toBe("=2-3%clove");
    expect(formatQuantity(parseQuantity("3"))).toBe("3");
  });
});

describe("isValidQuantity", () => {
  it("refuses a zero denominator, a non-finite number and an inverted range", () => {
    expect(isValidQuantity(parseQuantity("1/0"))).toBe(false);
    expect(isValidQuantity(parseQuantity("0/0 g"))).toBe(false);
    expect(isValidQuantity(parseQuantity("1" + "0".repeat(400)))).toBe(false);
    expect(isValidQuantity(parseQuantity("3-2"))).toBe(false);
  });

  it("accepts ordinary amounts, ranges and Vague amounts", () => {
    for (const text of ["2-3", "2-2", "1 1/2 cups", "a pinch", "", "=1%tsp"]) {
      expect(isValidQuantity(parseQuantity(text)), text).toBe(true);
    }
  });
});
