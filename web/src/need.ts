import type { ShoppingRow } from "./api.ts";

// "≈ 250 g", "6" (pieces), "a pinch", "40 g + 2 thumb ⚠ needs conversion": raw values in the Main
// unit (#91 owner decision 4), Vague amounts as written, parts that can't be converted flagged.
// The data stays raw; only the text drops float noise (0.1 × 3 × 1000 = 300.00000000000006) at
// 12 significant digits. That isn't units spec §7 rounding.
export function needText(row: ShoppingRow) {
  const number = (value: number) => String(Number(value.toPrecision(12)));
  const amount = (value: number, unit: string | null) =>
    unit === null || unit === "each" ? number(value) : `${number(value)} ${unit}`;
  const parts = [
    ...(row.need === null ? [] : [`${row.approximate ? "≈ " : ""}${amount(row.need, row.unit)}`]),
    ...row.vague,
    ...row.unconverted.map((p) => `${amount(p.amount, p.unit)} ⚠ needs conversion`),
  ];
  return parts.join(" + ");
}
