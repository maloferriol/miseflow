import { describe, expect, it } from "vitest";
import { findIngredient, normaliseName, searchCatalog, type CatalogEntry } from "./match.ts";

describe("findIngredient", () => {
  it("finds the seed Ingredient 'shallot' when searching 'Shallots'", () => {
    const catalog: CatalogEntry[] = [{ id: "s1", name: "shallot", source: "seed", aliases: [] }];
    expect(findIngredient(catalog, "Shallots")?.id).toBe("s1");
  });

  it("finds a seed alias whatever its case and accents", () => {
    const catalog: CatalogEntry[] = [
      {
        id: "s1",
        name: "shallot",
        source: "seed",
        aliases: [{ name: "échalote", source: "seed" }],
      },
    ];
    expect(findIngredient(catalog, "Échalote")?.id).toBe("s1");
  });

  it("returns undefined when nothing matches exactly", () => {
    const catalog: CatalogEntry[] = [{ id: "s1", name: "shallot", source: "seed", aliases: [] }];
    expect(findIngredient(catalog, "shall")).toBeUndefined();
  });

  it("prefers a kitchen alias over a seed alias of the same name", () => {
    const catalog: CatalogEntry[] = [
      {
        id: "s1",
        name: "heavy cream",
        source: "seed",
        aliases: [{ name: "cream", source: "seed" }],
      },
      {
        id: "s2",
        name: "single cream",
        source: "seed",
        aliases: [{ name: "cream", source: "own" }],
      },
    ];
    expect(findIngredient(catalog, "cream")?.id).toBe("s2");
  });

  it("prefers a kitchen alias over a seed name", () => {
    const catalog: CatalogEntry[] = [
      { id: "s1", name: "sugar", source: "seed", aliases: [] },
      {
        id: "o1",
        name: "golden caster sugar",
        source: "own",
        aliases: [{ name: "sugar", source: "own" }],
      },
    ];
    expect(findIngredient(catalog, "Sugar")?.id).toBe("o1");
  });

  it("prefers a seed name over a seed alias", () => {
    const catalog: CatalogEntry[] = [
      {
        id: "s1",
        name: "cornflour",
        source: "seed",
        aliases: [{ name: "cornstarch", source: "seed" }],
      },
      { id: "s2", name: "cornstarch", source: "seed", aliases: [] },
    ];
    expect(findIngredient(catalog, "cornstarch")?.id).toBe("s2");
  });
});

describe("normaliseName", () => {
  it("folds case, accents and ligatures", () => {
    expect(normaliseName("Échalote")).toBe("echalote");
    expect(normaliseName("Œuf")).toBe("oeuf");
  });

  it("trims and collapses whitespace", () => {
    expect(normaliseName("  white   wine\tvinegar ")).toBe("white wine vinegar");
  });

  it("makes the last word singular", () => {
    expect(normaliseName("Shallots")).toBe("shallot");
    expect(normaliseName("tomatoes")).toBe("tomato");
    expect(normaliseName("berries")).toBe("berry");
    expect(normaliseName("peaches")).toBe("peach");
    expect(normaliseName("black peppercorns")).toBe("black peppercorn");
    expect(normaliseName("apples cider")).toBe("apples cider");
  });

  it("leaves words ending in -ss or -us alone", () => {
    expect(normaliseName("swiss")).toBe("swiss");
    expect(normaliseName("asparagus")).toBe("asparagus");
  });
});

describe("searchCatalog", () => {
  const catalog: CatalogEntry[] = [
    { id: "a", name: "butter", source: "seed", aliases: [] },
    { id: "b", name: "peanut butter", source: "seed", aliases: [] },
    { id: "c", name: "buttermilk", source: "seed", aliases: [] },
    {
      id: "d",
      name: "cream",
      source: "seed",
      aliases: [{ name: "double cream", source: "seed" }],
    },
  ];

  it("ranks exact matches, then prefix, then substring", () => {
    const results = searchCatalog(catalog, "butter", 10);
    expect(results.map((r) => r.entry.id)).toEqual(["a", "c", "b"]);
    expect(results.map((r) => r.exact)).toEqual([true, false, false]);
  });

  it("says when a result matched by an alias", () => {
    expect(searchCatalog(catalog, "double", 10)).toMatchObject([
      { entry: { id: "d" }, matchedBy: "alias", exact: false },
    ]);
  });

  it("lists by name when the query is empty, up to the limit", () => {
    expect(searchCatalog(catalog, " ", 2).map((r) => r.entry.name)).toEqual([
      "butter",
      "buttermilk",
    ]);
  });
});
