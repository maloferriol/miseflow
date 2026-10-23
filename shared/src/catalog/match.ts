// Matching names against the Ingredient catalog (ADR 0002): exact name or alias, ignoring case,
// accents and a plural last word. Pure, so the server, line matching (#83) and later the browser
// can all run it over the catalog they can see.

export type CatalogSource = "seed" | "own";

export type CatalogEntry = {
  id: string;
  name: string;
  source: CatalogSource;
  aliases: { name: string; source: CatalogSource }[];
};

export type SearchResult<E extends CatalogEntry = CatalogEntry> = {
  entry: E;
  matchedBy: "name" | "alias";
  exact: boolean;
};

const LIGATURES: Record<string, string> = { œ: "oe", æ: "ae", ß: "ss" };

/** The form two names are compared in: "  Échalotes " → "echalote". */
export function normaliseName(name: string): string {
  const folded = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[œæß]/g, (c) => LIGATURES[c]!)
    .replace(/[‘’]/g, "'")
    .trim()
    .replace(/\s+/g, " ");
  const words = folded.split(" ");
  words[words.length - 1] = singular(words[words.length - 1]!);
  return words.join(" ");
}

// A heuristic, applied to both sides of every comparison, so it only has to be consistent.
function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(oes|ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

// Lower ranks first: the kitchen's own names and aliases, then seed names, then seed aliases.
function tier(
  entry: CatalogEntry,
  matchedBy: "name" | "alias",
  source: CatalogSource,
): number {
  if (source === "own" || (matchedBy === "name" && entry.source === "own"))
    return 0;
  return matchedBy === "name" ? 1 : 2;
}

type Ranked<E extends CatalogEntry> = SearchResult<E> & {
  kind: number;
  tier: number;
};

// The best way `entry` matches `query` (already normalised): 0 exact, 1 prefix, 2 substring.
function rank<E extends CatalogEntry>(
  entry: E,
  query: string,
): Ranked<E> | undefined {
  const names = [
    { name: entry.name, matchedBy: "name" as const, source: entry.source },
    ...entry.aliases.map((a) => ({
      name: a.name,
      matchedBy: "alias" as const,
      source: a.source,
    })),
  ];
  let best: Ranked<E> | undefined;
  for (const candidate of names) {
    const normalised = normaliseName(candidate.name);
    const kind =
      normalised === query
        ? 0
        : normalised.startsWith(query)
          ? 1
          : normalised.includes(query)
            ? 2
            : -1;
    if (kind < 0) continue;
    const ranked = {
      entry,
      matchedBy: candidate.matchedBy,
      exact: kind === 0,
      kind,
      tier: tier(entry, candidate.matchedBy, candidate.source),
    };
    if (!best || byRank(ranked, best) < 0) best = ranked;
  }
  return best;
}

function byRank(a: Ranked<CatalogEntry>, b: Ranked<CatalogEntry>): number {
  return (
    a.kind - b.kind ||
    a.tier - b.tier ||
    a.entry.name.localeCompare(b.entry.name)
  );
}

/** The Ingredient `name` names exactly, if any. A kitchen's own name or alias wins. */
export function findIngredient<E extends CatalogEntry>(
  catalog: E[],
  name: string,
): E | undefined {
  const query = normaliseName(name);
  if (!query) return undefined;
  const exact = catalog
    .map((entry) => rank(entry, query))
    .filter((r): r is Ranked<E> => r?.kind === 0)
    .sort(byRank);
  return exact[0]?.entry;
}

/** Exact matches first (in `findIngredient`'s order), then prefix, then substring matches. */
export function searchCatalog<E extends CatalogEntry>(
  catalog: E[],
  query: string,
  limit: number,
): SearchResult<E>[] {
  const normalised = normaliseName(query);
  const ranked = normalised
    ? catalog
        .map((entry) => rank(entry, normalised))
        .filter((r): r is Ranked<E> => !!r)
    : catalog.map((entry) => ({
        entry,
        matchedBy: "name" as const,
        exact: false,
        kind: 0,
        tier: 0,
      }));
  return ranked
    .sort(byRank)
    .slice(0, limit)
    .map(({ entry, matchedBy, exact }) => ({ entry, matchedBy, exact }));
}
