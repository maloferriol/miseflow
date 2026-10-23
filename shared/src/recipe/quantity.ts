// Quantity parsing (units spec §1). Accepts the cook's "200 g" and Cooklang's "200%g"; a leading
// "=" sets the Fixed quantity flag (https://cooklang.org/docs/conventions/, "Use `=` to lock").

export type QuantityTier = "fixed" | "ingredient" | "vague" | "unknown";

export type Quantity = {
  /** 1.5 for "1 1/2" or "1½"; null for a Vague amount. */
  value: number | null;
  /** The upper end of a range: "2-3" → value 2, max 3. */
  max: number | null;
  /** Canonical for a recognised unit ("cups" → "cup"); raw when unrecognised; null = piece. */
  unit: string | null;
  tier: QuantityTier;
  fixed: boolean;
};

// Canonical unit → spellings, matched regardless of case after trailing dots are dropped.
const SPELLINGS: Record<
  QuantityTier & ("fixed" | "ingredient" | "vague"),
  Record<string, string[]>
> = {
  fixed: {
    g: ["g", "gr", "gram", "grams", "gramme", "grammes"],
    kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
    mg: ["mg", "milligram", "milligrams"],
    oz: ["oz", "ounce", "ounces"],
    lb: ["lb", "lbs", "pound", "pounds"],
    ml: ["ml", "millilitre", "millilitres", "milliliter", "milliliters"],
    cl: ["cl", "centilitre", "centilitres", "centiliter", "centiliters"],
    dl: ["dl", "decilitre", "decilitres", "deciliter", "deciliters"],
    L: ["l", "litre", "litres", "liter", "liters"],
    tsp: ["tsp", "tsps", "teaspoon", "teaspoons"],
    tbsp: ["tbsp", "tbsps", "tablespoon", "tablespoons"],
    "fl oz": ["fl oz", "fl. oz", "fluid ounce", "fluid ounces"],
    cup: ["cup", "cups", "c"],
    pint: ["pint", "pints", "pt"],
    quart: ["quart", "quarts", "qt"],
    gallon: ["gallon", "gallons", "gal"],
  },
  ingredient: {
    clove: ["clove", "cloves"],
    slice: ["slice", "slices"],
    sprig: ["sprig", "sprigs"],
    head: ["head", "heads"],
    stick: ["stick", "sticks"],
    can: ["can", "cans"],
    bunch: ["bunch", "bunches"],
  },
  vague: {
    pinch: ["pinch", "pinches"],
    dash: ["dash", "dashes"],
    handful: ["handful", "handfuls"],
    "to taste": ["to taste"],
  },
};

const UNITS = new Map<string, { unit: string | null; tier: QuantityTier }>();
for (const [tier, units] of Object.entries(SPELLINGS)) {
  for (const [unit, spellings] of Object.entries(units)) {
    for (const spelling of spellings)
      UNITS.set(spelling, { unit, tier: tier as QuantityTier });
  }
}
// "piece" is the absence of a unit ("3 eggs").
for (const spelling of ["piece", "pieces", "pc", "pcs"]) {
  UNITS.set(spelling, { unit: null, tier: "ingredient" });
}

const VULGAR: Record<string, number> = {
  "½": 1 / 2,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅛": 1 / 8,
};

// "1", "1.5", "1/2", "1 1/2", "½", "1½"
const NUMBER = String.raw`(?:\d+(?:\.\d+)?(?:\s+\d+\/\d+|\s*[½⅓⅔¼¾⅛])?|\d+\/\d+|[½⅓⅔¼¾⅛])`;
const AMOUNT = new RegExp(
  String.raw`^(${NUMBER})(?:\s*[-–]\s*(${NUMBER}))?(?=\s|%|[^\d./]|$)\s*(.*)$`,
  "u",
);

function parseNumber(text: string): number {
  let total = 0;
  for (const part of text.match(/\d+\/\d+|\d+(?:\.\d+)?|[½⅓⅔¼¾⅛]/gu) ?? []) {
    if (part in VULGAR) total += VULGAR[part]!;
    else if (part.includes("/")) {
      const [n, d] = part.split("/").map(Number);
      total += n! / d!;
    } else total += Number(part);
  }
  return total;
}

function parseUnit(raw: string): { unit: string | null; tier: QuantityTier } {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text === "") return { unit: null, tier: "ingredient" };
  // Case matters only for single letters: "T" = tbsp, "t" = tsp.
  if (text === "T") return { unit: "tbsp", tier: "fixed" };
  if (text === "t") return { unit: "tsp", tier: "fixed" };
  const known = UNITS.get(text.toLowerCase().replace(/\.$/, ""));
  return known ?? { unit: text, tier: "unknown" };
}

export function parseQuantity(input: string): Quantity {
  let text = input.trim();
  const fixed = text.startsWith("=");
  if (fixed) text = text.slice(1).trim();
  if (text === "")
    return { value: null, max: null, unit: null, tier: "vague", fixed };

  // Cooklang writes the unit after a "%".
  const percent = text.indexOf("%");
  const amount = percent >= 0 ? text.slice(0, percent).trim() : text;
  const unitText = percent >= 0 ? text.slice(percent + 1) : null;

  const match = AMOUNT.exec(amount);
  let value: number | null = null;
  let max: number | null = null;
  let rest = amount;
  if (match) {
    value = parseNumber(match[1]!);
    max = match[2] ? parseNumber(match[2]) : null;
    rest = match[3]!;
  } else {
    // "a pinch", "an onion": the article is one.
    const article = /^an?\s+(.*)$/i.exec(amount);
    if (article) {
      value = 1;
      rest = article[1]!;
    }
  }
  const { unit, tier } = parseUnit(unitText ?? rest);
  if (tier === "vague")
    return { value: match ? value : null, max, unit, tier, fixed };
  // Words with no number and no known unit ("some") stay as written.
  if (value === null && tier === "ingredient" && unit === null)
    return { value: null, max: null, unit: null, tier: "vague", fixed };
  return { value, max, unit, tier, fixed };
}

/**
 * False for an amount no line can store: a zero denominator or a number too big to be finite
 * ("1/0" → Infinity, "0/0" → NaN, which a jsonb snapshot can't hold), or a range whose upper
 * end is below its lower end ("3-2").
 */
export function isValidQuantity(q: Quantity): boolean {
  const ok = (n: number | null) => n === null || Number.isFinite(n);
  return ok(q.value) && ok(q.max) && !(q.max !== null && q.value !== null && q.max < q.value);
}

/** Back to the Cooklang shorthand ("1.5%cup", "=2-3%clove"), so a saved line can be re-edited. */
export function formatQuantity(q: Quantity): string {
  const number =
    q.value === null
      ? ""
      : String(q.value) + (q.max === null ? "" : `-${q.max}`);
  const unit = q.unit === null ? "" : number ? `%${q.unit}` : q.unit;
  return (q.fixed ? "=" : "") + number + unit;
}
