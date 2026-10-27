import { describe, expect, it } from "vitest";
import { deriveBatches } from "../plan/batches.ts";
import type { RecipeSnapshot, SnapshotLine } from "../recipe/snapshot.ts";
import {
  type ConversionRow,
  deriveShoppingList,
  type ShoppingIngredient,
  type ShoppingList,
} from "./list.ts";

// Recipes as snapshots, one Step each, so each test reads as the lines it adds up.
let n = 0;
const nextId = () => `id-${++n}`;

type LineSpec = Partial<SnapshotLine> & ({ ingredientId: string } | { subRecipeId: string | null });
const line = (spec: LineSpec): SnapshotLine => ({
  id: nextId(),
  ingredientId: null,
  subRecipeId: null,
  quantity: null,
  quantityMax: null,
  unit: null,
  wording: "thing",
  preparation: null,
  fixedQuantity: false,
  position: "a0",
  ...spec,
});

const recipe = (
  name: string,
  lines: SnapshotLine[],
  extra: Partial<RecipeSnapshot> = {},
): RecipeSnapshot => ({
  name,
  servings: null,
  yield: null,
  makeAhead: null,
  steps: [
    {
      id: nextId(),
      position: "a0",
      body: [],
      lines,
      activeMinutes: 10,
      passiveMinutes: null,
      makeAhead: null,
      groupWithPrevious: false,
    },
  ],
  dependencies: [],
  ...extra,
});

const DAIRY = { id: "cat-dairy", name: "Dairy & eggs" };
const PRODUCE = { id: "cat-produce", name: "Produce" };
const DRY = { id: "cat-dry", name: "Dry goods" };
const SPICES = { id: "cat-spices", name: "Spices" };
// Seed order: Produce before Dairy & eggs before Dry goods before Spices.
const CATEGORIES = [PRODUCE, DAIRY, DRY, SPICES];

const ingredient = (
  id: string,
  preferredKind: string,
  shoppingCategory: { id: string; name: string } | null,
  mainUnit: string | null = null,
): ShoppingIngredient => ({
  id,
  name: id,
  preferredKind,
  mainUnit,
  shoppingCategory,
});
const CATALOG = [
  ingredient("butter", "mass", DAIRY),
  ingredient("flour", "mass", DRY),
  ingredient("salt", "mass", SPICES),
  ingredient("apple", "count", PRODUCE),
  ingredient("cream", "volume", DAIRY),
  ingredient("ginger", "mass", PRODUCE),
  ingredient("water", "volume", null),
];

type Menu = {
  guestCount: number | null;
  dishes: { recipe: RecipeSnapshot; scaleFactor?: number }[];
  subRecipes?: Record<string, RecipeSnapshot>;
};

function shoppingList(
  menu: Menu,
  options: {
    conversions?: Record<string, ConversionRow[]>;
    catalog?: ShoppingIngredient[];
    got?: string[];
  } = {},
): ShoppingList {
  const recipes = new Map<string, RecipeSnapshot>(Object.entries(menu.subRecipes ?? {}));
  const dishes = menu.dishes.map((d, i) => {
    const recipeId = `recipe-${i}`;
    recipes.set(recipeId, d.recipe);
    return { dishId: `dish-${i}`, recipeId, scaleFactor: d.scaleFactor ?? null };
  });
  const scale = deriveBatches({ guestCount: menu.guestCount, region: "metric", dishes, recipes });
  return deriveShoppingList({
    region: "metric",
    dishes,
    recipes,
    scale,
    catalog: options.catalog ?? CATALOG,
    categories: CATEGORIES,
    kitchenUnits: { mass: "g", volume: "ml", count: "each" },
    conversions: (id) => options.conversions?.[id] ?? [],
    got: new Set(options.got ?? []),
  });
}

const rows = (list: ShoppingList) => list.categories.flatMap((c) => c.rows);
const row = (list: ShoppingList, ingredientId: string) =>
  rows(list).find((r) => r.ingredientId === ingredientId);

describe("deriveShoppingList", () => {
  it("adds butter from the Beurre blanc and the Pastry on one row in grams", () => {
    // The duck (servings 6) at 12 guests is ×2 and uses 300 ml of Beurre blanc (yield 300 ml): ×2.
    // The tarte (servings 6) is ×2 and uses 1 Pastry (yield 1): ×2.
    const beurre = recipe(
      "Beurre blanc",
      [line({ ingredientId: "butter", quantity: 200, unit: "g", wording: "butter" })],
      {
        yield: { quantity: 300, unit: "ml" },
      },
    );
    const pastry = recipe(
      "Pastry",
      [line({ ingredientId: "butter", quantity: 0.1, unit: "kg", wording: "butter" })],
      {
        yield: { quantity: 1, unit: null },
      },
    );
    const list = shoppingList({
      guestCount: 12,
      dishes: [
        {
          recipe: recipe(
            "Duck",
            [line({ subRecipeId: "beurre", quantity: 300, unit: "ml", wording: "beurre blanc" })],
            { servings: 6 },
          ),
        },
        {
          recipe: recipe(
            "Tarte tatin",
            [line({ subRecipeId: "pastry", quantity: 1, wording: "pastry" })],
            { servings: 6 },
          ),
        },
      ],
      subRecipes: { beurre, pastry },
    });
    expect(rows(list).filter((r) => r.ingredientId === "butter")).toEqual([
      expect.objectContaining({
        name: "butter",
        need: 600,
        unit: "g",
        approximate: false,
        vague: [],
        unconverted: [],
      }),
    ]);
  });

  it("turns 2 cups flour into grams through a reference Conversion, marked ≈", () => {
    // A reference cup of flour (USDA FDC 168894: 125 g), injected by the test (owner decision 2).
    const conversions = {
      flour: [{ fromUnit: "cup", toUnit: "g", factor: 125, source: "seed" as const }],
    };
    const list = shoppingList(
      {
        guestCount: null,
        dishes: [
          {
            recipe: recipe("Bread", [
              line({ ingredientId: "flour", quantity: 2, unit: "cup", wording: "flour" }),
            ]),
          },
        ],
      },
      { conversions },
    );
    expect(row(list, "flour")).toMatchObject({
      need: 250,
      unit: "g",
      approximate: true,
      unconverted: [],
    });

    // 4 tbsp is 60 ml, a quarter of a metric cup within its kind first, then 31.25 g.
    const tbsp = shoppingList(
      {
        guestCount: null,
        dishes: [
          {
            recipe: recipe("Roux", [
              line({ ingredientId: "flour", quantity: 4, unit: "tbsp", wording: "flour" }),
            ]),
          },
        ],
      },
      { conversions },
    );
    expect(row(tbsp, "flour")).toMatchObject({
      need: (60 / 250) * 125,
      unit: "g",
      approximate: true,
    });
  });

  it("converts through a Conversion from the line's own unit, then within the Main unit's kind", () => {
    // A kg Main unit override: a seed onion is 110 g each (≈), and 220 g is 0.22 kg.
    const catalog = [...CATALOG, ingredient("onion", "mass", PRODUCE, "kg")];
    const conversions = {
      onion: [{ fromUnit: "each", toUnit: "g", factor: 110, source: "seed" as const }],
      flour: [{ fromUnit: "cup", toUnit: "g", factor: 125, source: "seed" as const }],
    };
    const list = shoppingList(
      {
        guestCount: null,
        dishes: [
          {
            recipe: recipe("Soup", [
              line({ ingredientId: "onion", quantity: 2, wording: "onions" }),
              line({ ingredientId: "flour", quantity: 2, unit: "cup" }),
            ]),
          },
        ],
      },
      {
        catalog: catalog.map((i) => (i.id === "flour" ? { ...i, mainUnit: "kg" } : i)),
        conversions,
      },
    );
    expect(row(list, "onion")).toMatchObject({
      need: 0.22,
      unit: "kg",
      approximate: true,
      unconverted: [],
    });
    expect(row(list, "flour")).toMatchObject({
      need: 0.25,
      unit: "kg",
      approximate: true,
      unconverted: [],
    });
  });

  it("lists a pinch of salt on its row without adding it to a total", () => {
    const list = shoppingList({
      guestCount: 12,
      dishes: [
        {
          recipe: recipe(
            "Pastry",
            [
              line({ ingredientId: "salt", quantity: null, unit: "pinch", wording: "salt" }),
              line({ ingredientId: "salt", quantity: 5, unit: "g", wording: "salt" }),
            ],
            { servings: 4 },
          ),
        },
      ],
    });
    // ×3: the 5 g scales, the pinch stays as written (owner decision 5).
    expect(row(list, "salt")).toMatchObject({
      need: 15,
      unit: "g",
      vague: ["a pinch"],
      approximate: false,
    });
  });

  it("counts a Fixed quantity once per Dish", () => {
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Pasta", [
            line({
              ingredientId: "salt",
              quantity: 10,
              unit: "g",
              fixedQuantity: true,
              wording: "salt",
            }),
            line({ ingredientId: "flour", quantity: 100, unit: "g", wording: "flour" }),
          ]),
          scaleFactor: 3,
        },
        {
          recipe: recipe("Gnocchi", [
            line({
              ingredientId: "salt",
              quantity: 10,
              unit: "g",
              fixedQuantity: true,
              wording: "salt",
            }),
          ]),
          scaleFactor: 2,
        },
      ],
    });
    expect(row(list, "salt")).toMatchObject({ need: 20, unit: "g" });
    expect(row(list, "flour")).toMatchObject({ need: 300, unit: "g" });
  });

  it("counts a Fixed quantity in a sub-recipe once per Batch", () => {
    // The stock (yield 1 L) is used 1.5 L by a Dish ×2: ×3. Its fixed salt counts once.
    const stock = recipe(
      "Stock",
      [
        line({
          ingredientId: "salt",
          quantity: 10,
          unit: "g",
          fixedQuantity: true,
          wording: "salt",
        }),
        line({ ingredientId: "water", quantity: 1, unit: "L", wording: "water" }),
      ],
      { yield: { quantity: 1, unit: "L" } },
    );
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Soup", [
            line({ subRecipeId: "stock", quantity: 1.5, unit: "L", wording: "stock" }),
          ]),
          scaleFactor: 2,
        },
      ],
      subRecipes: { stock },
    });
    expect(row(list, "salt")).toMatchObject({ need: 10, unit: "g" });
    expect(row(list, "water")).toMatchObject({ need: 3000, unit: "ml" });
  });

  it("scales a sub-recipe's Ingredients by its Batch's Scale factor, with no row for the sub-recipe", () => {
    // 750 g of Pastry at ×2 from a yield of 500 g: ×3.
    const pastry = recipe(
      "Pastry",
      [line({ ingredientId: "flour", quantity: 200, unit: "g", wording: "flour" })],
      { yield: { quantity: 500, unit: "g" } },
    );
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Tart", [
            line({ subRecipeId: "pastry", quantity: 750, unit: "g", wording: "pastry" }),
          ]),
          scaleFactor: 2,
        },
      ],
      subRecipes: { pastry },
    });
    expect(rows(list).map((r) => [r.ingredientId, r.need])).toEqual([["flour", 600]]);
    expect(rows(list).some((r) => r.ingredientId === "pastry" || r.name === "Pastry")).toBe(false);
    expect(list.missing).toEqual([]);
  });

  it("marks ≈ the Ingredients of a sub-recipe that couldn't be scaled", () => {
    // No yield: the Batch is assumed ×1, so its flour is an Approximate total.
    const pastry = recipe("Pastry", [
      line({ ingredientId: "flour", quantity: 200, unit: "g", wording: "flour" }),
    ]);
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Tart", [
            line({ subRecipeId: "pastry", quantity: 750, unit: "g", wording: "pastry" }),
          ]),
          scaleFactor: 2,
        },
      ],
      subRecipes: { pastry },
    });
    expect(row(list, "flour")).toMatchObject({ need: 200, approximate: true });
  });

  it("groups rows by Shopping category in seed order, with a trailing No category group", () => {
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Everything", [
            line({ ingredientId: "salt", quantity: 5, unit: "g" }),
            line({ ingredientId: "water", quantity: 100, unit: "ml" }),
            line({ ingredientId: "flour", quantity: 100, unit: "g" }),
            line({ ingredientId: "cream", quantity: 100, unit: "ml" }),
            line({ ingredientId: "butter", quantity: 100, unit: "g" }),
            line({ ingredientId: "apple", quantity: 2 }),
          ]),
        },
      ],
    });
    expect(list.categories.map((c) => [c.id, c.name, c.rows.map((r) => r.name)])).toEqual([
      ["cat-produce", "Produce", ["apple"]],
      ["cat-dairy", "Dairy & eggs", ["butter", "cream"]],
      ["cat-dry", "Dry goods", ["flour"]],
      ["cat-spices", "Spices", ["salt"]],
      [null, "No category", ["water"]],
    ]);
  });

  it("uses the Ingredient's override category and Main unit", () => {
    // As loadCatalog merges an override: cream in litres, bought with the Dry goods.
    const catalog = CATALOG.map((i) =>
      i.id === "cream" ? { ...i, mainUnit: "L", shoppingCategory: DRY } : i,
    );
    const list = shoppingList(
      {
        guestCount: null,
        dishes: [
          {
            recipe: recipe("Sauce", [line({ ingredientId: "cream", quantity: 250, unit: "ml" })]),
            scaleFactor: 3,
          },
        ],
      },
      { catalog },
    );
    expect(
      list.categories.map((c) => [c.name, c.rows.map((r) => [r.name, r.need, r.unit])]),
    ).toEqual([["Dry goods", [["cream", 0.75, "L"]]]]);
  });

  it("adds pieces up against the count Main unit each", () => {
    // parseQuantity's piece (no unit) is the seed's and kitchen's "each".
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Tarte tatin", [
            line({ ingredientId: "apple", quantity: 6, wording: "apples" }),
          ]),
          scaleFactor: 2,
        },
      ],
    });
    expect(row(list, "apple")).toMatchObject({
      need: 12,
      unit: "each",
      approximate: false,
      unconverted: [],
    });
  });

  it("flags a line with a Missing sub-recipe and adds nothing for it", () => {
    const missing = line({ subRecipeId: "gone", quantity: 500, unit: "g", wording: "puff pastry" });
    const unlinked = line({ subRecipeId: null, quantity: 1, wording: "jus" });
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Tart", [
            missing,
            unlinked,
            line({ ingredientId: "flour", quantity: 100, unit: "g" }),
          ]),
          scaleFactor: 2,
        },
      ],
    });
    expect(list.missing).toEqual([
      { lineId: missing.id, recipeName: "Tart", wording: "puff pastry" },
      { lineId: unlinked.id, recipeName: "Tart", wording: "jus" },
    ]);
    expect(rows(list).map((r) => [r.ingredientId, r.need])).toEqual([["flour", 200]]);
  });

  it("totals a range at its upper end", () => {
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Tatin", [line({ ingredientId: "apple", quantity: 2, quantityMax: 3 })]),
          scaleFactor: 2,
        },
      ],
    });
    expect(row(list, "apple")).toMatchObject({ need: 6 });
  });

  it("keeps a part that can't be converted on its row, flagged", () => {
    const list = shoppingList({
      guestCount: null,
      dishes: [
        {
          recipe: recipe("Curry", [
            line({ ingredientId: "ginger", quantity: 40, unit: "g" }),
            line({ ingredientId: "ginger", quantity: 2, unit: "thumb" }),
            line({ ingredientId: "ginger", quantity: 1, unit: "cup" }),
          ]),
          scaleFactor: 2,
        },
      ],
    });
    expect(row(list, "ginger")).toMatchObject({
      need: 80,
      unit: "g",
      unconverted: [
        { amount: 4, unit: "thumb" },
        { amount: 2, unit: "cup" },
      ],
    });
  });

  it("marks each row Got from the Service's marks", () => {
    const list = shoppingList(
      {
        guestCount: null,
        dishes: [
          {
            recipe: recipe("Tart", [
              line({ ingredientId: "flour", quantity: 100, unit: "g" }),
              line({ ingredientId: "butter", quantity: 50, unit: "g" }),
            ]),
          },
        ],
      },
      { got: ["butter"] },
    );
    expect(rows(list).map((r) => [r.ingredientId, r.got])).toEqual([
      ["butter", true],
      ["flour", false],
    ]);
  });
});
