import { z } from "zod";
import { formatQuantity } from "./quantity.ts";

// A Step's body (steps.body, ADR 0010): text, or a reference to one of the Step's Ingredient
// lines. It maps one to one onto Cooklang's `@name{qty%unit}(prep)`
// (https://cooklang.org/docs/spec/#ingredients), which is also how the cook types it.
export const stepTokenSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    text: z.string().min(1).max(2000),
  }),
  z.strictObject({ type: z.literal("line"), lineId: z.uuid() }),
]);
export const stepBodySchema = z.array(stepTokenSchema).max(200);

export type StepToken = z.infer<typeof stepTokenSchema>;

export type StepTextPart =
  | { type: "text"; text: string }
  | { type: "ref"; name: string; amount: string; preparation: string | null };

/** What `formatStepText` needs to know about a line. */
export type LineText = {
  wording: string | null;
  quantity: number | null;
  quantityMax: number | null;
  unit: string | null;
  fixedQuantity: boolean;
  preparation: string | null;
};

// `@` starts a ref only after a non-word character, so "chef@example.com" stays text.
// A multi-word name runs up to its `{…}`; without braces the name is one word.
const BRACED = /^([^@{}()\n]+?)\{([^{}\n]*)\}(?:\(([^()\n]*)\))?/u;
const SINGLE = /^[\p{L}\p{N}_-]+/u;

/**
 * An Ingredient name as a ref can carry it: `@ { } ( )` and line breaks delimit a ref, and a ref
 * starts with a letter or digit. "Pepper (black)" → "Pepper black". The line still links to the
 * picked Ingredient by id; this is only its wording.
 */
export function refName(name: string): string {
  return name
    .replace(/[@{}()\n\r]/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStepText(text: string): StepTextPart[] {
  const parts: StepTextPart[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const before = i === 0 ? "" : text[i - 1];
    if (text[i] === "@" && !/[\p{L}\p{N}_]/u.test(before)) {
      const rest = text.slice(i + 1);
      const braced = BRACED.exec(rest);
      const single = braced ? null : SINGLE.exec(rest);
      const name = (braced?.[1] ?? single?.[0] ?? "").trim();
      if (name && /^[\p{L}\p{N}]/u.test(rest)) {
        if (plain) parts.push({ type: "text", text: plain });
        plain = "";
        parts.push({
          type: "ref",
          name,
          amount: braced?.[2]?.trim() ?? "",
          preparation: braced?.[3]?.trim() || null,
        });
        i += 1 + (braced?.[0] ?? single![0]).length;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  if (plain) parts.push({ type: "text", text: plain });
  return parts;
}

/** Tokens and their lines back to the shorthand, so a saved Step can be edited again. */
export function formatStepText(body: StepToken[], lines: Map<string, LineText>): string {
  return body
    .map((token) => {
      if (token.type === "text") return token.text;
      const line = lines.get(token.lineId);
      if (!line) return "";
      const amount = formatQuantity({
        value: line.quantity,
        max: line.quantityMax,
        unit: line.unit,
        // A placeholder: formatQuantity doesn't read the tier.
        tier: "fixed",
        fixedQuantity: line.fixedQuantity,
      });
      return (
        `@${line.wording ?? ""}{${amount}}` + (line.preparation ? `(${line.preparation})` : "")
      );
    })
    .join("");
}
