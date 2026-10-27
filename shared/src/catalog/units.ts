import { z } from "zod";

// The Fixed units of units spec §1 by kind of measure, plus "each" (kitchen_settings.count_unit)
// for counted Ingredients. Ingredient units (clove, bunch…) are not Main units.
export const UNITS_BY_KIND = {
  mass: ["g", "kg", "mg", "oz", "lb"],
  volume: ["ml", "cl", "dl", "L", "tsp", "tbsp", "fl oz", "cup", "pint", "quart", "gallon"],
  count: ["each"],
} as const;

export type Kind = keyof typeof UNITS_BY_KIND;
export type Unit = (typeof UNITS_BY_KIND)[Kind][number];

export const kindSchema = z.enum(["mass", "volume", "count"]);
export const unitSchema = z.enum([
  ...UNITS_BY_KIND.mass,
  ...UNITS_BY_KIND.volume,
  ...UNITS_BY_KIND.count,
]);

export function unitFitsKind(unit: Unit, kind: Kind): boolean {
  return (UNITS_BY_KIND[kind] as readonly string[]).includes(unit);
}
