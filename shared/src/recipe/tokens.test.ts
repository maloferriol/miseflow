import { describe, expect, it } from "vitest";
import { formatStepText, parseStepText, refName, stepBodySchema } from "./tokens.ts";

describe("parseStepText", () => {
  it("splits text and Ingredient refs with amount and preparation", () => {
    expect(parseStepText("Sweat @shallots{2}(brunoise) in @butter{30%g}")).toEqual([
      { type: "text", text: "Sweat " },
      { type: "ref", name: "shallots", amount: "2", preparation: "brunoise" },
      { type: "text", text: " in " },
      { type: "ref", name: "butter", amount: "30%g", preparation: null },
    ]);
  });

  it("reads a multi-word name up to its braces", () => {
    expect(parseStepText("Add @olive oil{} now")).toEqual([
      { type: "text", text: "Add " },
      { type: "ref", name: "olive oil", amount: "", preparation: null },
      { type: "text", text: " now" },
    ]);
  });

  it("reads a single-word name without braces", () => {
    expect(parseStepText("Season with @salt and @pepper{}.")).toEqual([
      { type: "text", text: "Season with " },
      { type: "ref", name: "salt", amount: "", preparation: null },
      { type: "text", text: " and " },
      { type: "ref", name: "pepper", amount: "", preparation: null },
      { type: "text", text: "." },
    ]);
  });

  it("keeps an @ with no name, and an email-like a@b, as text", () => {
    expect(parseStepText("Mail chef@example.com @ noon")).toEqual([
      { type: "text", text: "Mail chef@example.com @ noon" },
    ]);
  });
});

describe("formatStepText", () => {
  it("writes the shorthand back from tokens and lines, so a saved Step re-parses the same", () => {
    const text = "Sweat @shallots{2}(brunoise) in @butter{=30%g}";
    const shallots = crypto.randomUUID();
    const butter = crypto.randomUUID();
    const lines = new Map([
      [shallots, { wording: "shallots", quantity: 2, quantityMax: null, unit: null, fixedQuantity: false, preparation: "brunoise" }],
      [butter, { wording: "butter", quantity: 30, quantityMax: null, unit: "g", fixedQuantity: true, preparation: null }],
    ]);
    const body = [
      { type: "text" as const, text: "Sweat " },
      { type: "line" as const, lineId: shallots },
      { type: "text" as const, text: " in " },
      { type: "line" as const, lineId: butter },
    ];
    expect(formatStepText(body, lines)).toBe(text);
    expect(parseStepText(formatStepText(body, lines))).toEqual(parseStepText(text));
  });
});

describe("stepBodySchema", () => {
  it("accepts text and line tokens and rejects anything else", () => {
    expect(stepBodySchema.safeParse([{ type: "text", text: "Stir" }, { type: "line", lineId: crypto.randomUUID() }]).success).toBe(true);
    expect(stepBodySchema.safeParse([{ type: "line", lineId: "nope" }]).success).toBe(false);
    expect(stepBodySchema.safeParse([{ type: "html", html: "<b>" }]).success).toBe(false);
    expect(stepBodySchema.safeParse([{ type: "text", text: "x".repeat(2001) }]).success).toBe(false);
  });
});

describe("refName", () => {
  it("makes any Ingredient name safe to write as a ref, so it parses back whole", () => {
    for (const [name, safe] of [
      ["Pepper (black)", "Pepper black"],
      ["{weird} @name", "weird name"],
      ["-'nduja", "nduja"],
      ["olive oil", "olive oil"],
    ]) {
      expect(refName(name!)).toBe(safe);
      expect(parseStepText(`Add @${refName(name!)}{}`)).toEqual([
        { type: "text", text: "Add " },
        { type: "ref", name: safe, amount: "", preparation: null },
      ]);
    }
  });
});
