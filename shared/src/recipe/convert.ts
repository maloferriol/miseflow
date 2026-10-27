// Quantity conversion (units spec §1 and §3). Pure: Fixed units convert by a constant within
// their kind of measure; anything else goes through an injected Conversion lookup.
import { unitTier } from "./quantity.ts";

/** `kitchen_settings.unit_region`; the MVP is fixed to "metric" (ADR 0004). */
export type Region = "metric" | "us";

/** A canonical unit as parseQuantity gives it; null = piece. */
export type Amount = { value: number; unit: string | null };

/** A Conversion from one unit to another: `source: "seed"` is a reference value (≈). */
export type ConversionLookup = (
  from: string | null,
  to: string | null,
) => { factor: number; source: "seed" | "own" } | null;

// Grams per unit. oz and lb are the international avoirdupois values.
const MASS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };

// Millilitres per unit. cup, pint and fl oz from units spec §1. Quart and gallon aren't in the
// spec; they follow the pint's region:
// - metric (the UK's imperial pint): gallon 4.546 09 L and quart ¼ gallon, Weights and Measures
//   Act 1985, Schedule 1, Part VI: https://www.legislation.gov.uk/ukpga/1985/72/schedule/1
// - US: liquid quart 946.352 9 ml and gallon 3 785.411 784 ml, NIST Handbook 44 (2026),
//   Appendix C, Units of Liquid Volume: https://www.nist.gov/document/2026-nist-handbook-44-appendix-c
const VOLUME_BASE: Record<string, number> = { ml: 1, cl: 10, dl: 100, L: 1000, tsp: 5, tbsp: 15 };
const VOLUME_REGION: Record<Region, Record<string, number>> = {
  metric: { cup: 250, pint: 568, "fl oz": 28.4, quart: 1136.5225, gallon: 4546.09 },
  us: { cup: 236.6, pint: 473, "fl oz": 29.6, quart: 946.3529, gallon: 3785.411784 },
};

// Which kind of measure a Fixed unit is, and its size in that kind's base unit.
function fixedSize(
  unit: string | null,
  region: Region,
): { kind: "mass" | "volume"; size: number } | null {
  if (unit === null || unitTier(unit) !== "fixed") return null;
  if (unit in MASS) return { kind: "mass", size: MASS[unit]! };
  const volume = VOLUME_BASE[unit] ?? VOLUME_REGION[region][unit];
  return volume === undefined ? null : { kind: "volume", size: volume };
}

/**
 * `amount` in the unit `to`. The same unit (pieces, cloves, g…) stays as is; two Fixed units of
 * one kind convert by a constant, exactly; anything else goes through `lookup`, ≈ when its value
 * is a reference one. Null: it can't be converted.
 */
export function convert(
  amount: Amount,
  to: string | null,
  region: Region,
  lookup?: ConversionLookup,
): { value: number; approximate: boolean } | null {
  if (amount.unit === to) return { value: amount.value, approximate: false };
  const from = fixedSize(amount.unit, region);
  const into = fixedSize(to, region);
  if (from && into && from.kind === into.kind)
    return { value: (amount.value * from.size) / into.size, approximate: false };
  const conversion = lookup?.(amount.unit, to);
  if (!conversion) return null;
  return { value: amount.value * conversion.factor, approximate: conversion.source === "seed" };
}
