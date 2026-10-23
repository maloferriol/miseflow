import { generateKeyBetween } from "fractional-indexing";

// Fractional-index positions (ADR 0010). Keys use the same base-62 format
// as rocicorp's `fractional-indexing` ("a0", "a1", … "az", "b00"), which `positionBetween` uses
// to insert between two keys. They compare in byte order:
// in Postgres, order by `position collate "C"`.
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** The key that sorts right after `last` (or the first key when there is none). */
export function positionAfter(last: string | null): string {
  if (last === null) return "a0";
  const head = last[0];
  if (head === undefined || head < "a" || head > "y") {
    throw new Error(`Unsupported position: ${last}`);
  }
  // The head letter sets how many digits the integer part has: "a" → 1, "b" → 2, …
  const digitCount = head.charCodeAt(0) - "a".charCodeAt(0) + 1;
  const digits = last.slice(1, 1 + digitCount).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]!) + 1;
    if (next < DIGITS.length) {
      digits[i] = DIGITS[next]!;
      return head + digits.join("");
    }
    digits[i] = "0";
  }
  // Every digit carried over: move to the next head letter, one digit longer.
  return String.fromCharCode(head.charCodeAt(0) + 1) + digits.join("") + "0";
}

/** A key that sorts between `before` and `after` (null: the start or the end). */
export function positionBetween(before: string | null, after: string | null): string {
  // Source: https://github.com/rocicorp/fractional-indexing (3.2.0), generateKeyBetween(a, b).
  return generateKeyBetween(before, after);
}
