import { describe, expect, it } from "vitest";
import { formatQuantity, isValidQuantity, parseQuantity } from "./quantity.ts";

describe("parseQuantity", () => {
  it('parses "1 1/2 cups" as 1.5 cup, a Fixed unit', () => {
    expect(parseQuantity("1 1/2 cups")).toEqual({
      value: 1.5,
      max: null,
      unit: "cup",
      tier: "fixed",
      fixedQuantity: false,
    });
  });

  it('parses "200 g" as 200 g, a Fixed unit', () => {
    expect(parseQuantity("200 g")).toEqual({
      value: 200,
      max: null,
      unit: "g",
      tier: "fixed",
      fixedQuantity: false,
    });
  });

  it('parses "2-3" and "2–3" as a range of pieces', () => {
    const range = { value: 2, max: 3, unit: null, tier: "ingredient", fixedQuantity: false };
    expect(parseQuantity("2-3")).toEqual(range);
    expect(parseQuantity("2–3")).toEqual(range);
  });

  it('parses "3" as 3 pieces, an Ingredient unit', () => {
    expect(parseQuantity("3")).toEqual({
      value: 3,
      max: null,
      unit: null,
      tier: "ingredient",
      fixedQuantity: false,
    });
  });

  it('parses "1 clove" as an Ingredient unit', () => {
    expect(parseQuantity("1 clove")).toEqual({
      value: 1,
      max: null,
      unit: "clove",
      tier: "ingredient",
      fixedQuantity: false,
    });
  });

  it('parses "a pinch" as a Vague amount', () => {
    expect(parseQuantity("a pinch")).toEqual({
      value: null,
      max: null,
      unit: "pinch",
      tier: "vague",
      fixedQuantity: false,
    });
  });

  it("parses an empty amount as a Vague amount", () => {
    expect(parseQuantity("")).toEqual({
      value: null,
      max: null,
      unit: null,
      tier: "vague",
      fixedQuantity: false,
    });
  });

  it('sets Fixed quantity from a leading "=" ("=1%tsp")', () => {
    expect(parseQuantity("=1%tsp")).toEqual({
      value: 1,
      max: null,
      unit: "tsp",
      tier: "fixed",
      fixedQuantity: true,
    });
  });

  it('reads the Cooklang form "30%g"', () => {
    expect(parseQuantity("30%g")).toMatchObject({ value: 30, unit: "g", tier: "fixed" });
  });

  it('reads Unicode fractions ("½", "1½")', () => {
    expect(parseQuantity("½")).toMatchObject({ value: 0.5, unit: null });
    expect(parseQuantity("1½ tbsp")).toMatchObject({ value: 1.5, unit: "tbsp" });
  });

  it('reads a comma as a decimal separator ("1,5 kg", "1,25-1,5 L")', () => {
    expect(parseQuantity("1,5 kg")).toEqual({
      value: 1.5,
      max: null,
      unit: "kg",
      tier: "fixed",
      fixedQuantity: false,
    });
    expect(parseQuantity("1,25-1,5 L")).toMatchObject({ value: 1.25, max: 1.5, unit: "L" });
  });

  it('keeps an unrecognised unit raw ("2 knobs")', () => {
    expect(parseQuantity("2 knobs")).toEqual({
      value: 2,
      max: null,
      unit: "knobs",
      tier: "unknown",
      fixedQuantity: false,
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

  it("round-trips every accepted amount, from the smallest to the largest it accepts", () => {
    const texts = ["1,5 kg", "1,25-1,5 L", "=0,5%tsp", "1 1/3 cups", "⅓", "2½-3 cloves", "1/7 g"];
    // Written out in digits, as a cook would: 0.000001 g up to 100000000000000000000 g.
    for (let zeros = 0; zeros <= 20; zeros++) texts.push(`1${"0".repeat(zeros)} g`);
    for (let zeros = 0; zeros <= 5; zeros++) texts.push(`0.${"0".repeat(zeros)}1 g`);
    texts.push("1/1000000", "9".repeat(20), "99999999999999999999.5");
    for (const text of texts) {
      const quantity = parseQuantity(text);
      expect(isValidQuantity(quantity), text).toBe(true);
      expect(parseQuantity(formatQuantity(quantity)), text).toEqual(quantity);
    }
  });

  it("writes the Cooklang shorthand", () => {
    expect(formatQuantity(parseQuantity("1 1/2 cups"))).toBe("1.5%cup");
    expect(formatQuantity(parseQuantity("=2-3 cloves"))).toBe("=2-3%clove");
    expect(parseQuantity("=200 g")).toMatchObject({ value: 200, unit: "g", fixedQuantity: true });
    expect(formatQuantity(parseQuantity("=200 g"))).toBe("=200%g");
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

  it('refuses a number it could only half read ("1,000 g": a thousand, or one?)', () => {
    for (const text of ["1,000 g", "2,500", "1,000%g", "=2,500%ml", "1-1,000 g", "1,000-2,000%g"]) {
      expect(isValidQuantity(parseQuantity(text)), text).toBe(false);
    }
  });

  it('refuses zero ("0", "0 g", "0-1"): leave the amount empty instead', () => {
    for (const text of ["0", "0 g", "0,0 kg", "0-1"]) {
      expect(isValidQuantity(parseQuantity(text)), text).toBe(false);
    }
  });

  it("refuses a number formatQuantity would write with an exponent, too big or too small", () => {
    expect(formatQuantity(parseQuantity("9".repeat(40)))).toBe("1e+40");
    expect(isValidQuantity(parseQuantity("9".repeat(40)))).toBe(false);
    expect(isValidQuantity(parseQuantity("1" + "0".repeat(21)))).toBe(false);
    expect(isValidQuantity(parseQuantity("1-1" + "0".repeat(21)))).toBe(false);
    expect(isValidQuantity(parseQuantity("1/10000000 g"))).toBe(false);
    expect(isValidQuantity(parseQuantity("1" + "0".repeat(20)))).toBe(true);
    expect(isValidQuantity(parseQuantity("1/1000000 g"))).toBe(true);
  });

  it("accepts ordinary amounts, ranges and Vague amounts", () => {
    for (const text of ["2-3", "2-2", "1 1/2 cups", "a pinch", "", "=1%tsp"]) {
      expect(isValidQuantity(parseQuantity(text)), text).toBe(true);
    }
  });
});
