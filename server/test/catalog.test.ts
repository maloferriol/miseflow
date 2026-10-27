import {
  ingredientAliases,
  ingredientOverrides,
  ingredients,
  shoppingCategories,
} from "@miseflow/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSeed, readSeed } from "../src/seed.ts";
import { db, getToken, testApp } from "./helpers.ts";

async function send(method: "GET" | "POST", path: string, body?: unknown) {
  return testApp().request(path, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function mutate(name: string, args: Record<string, unknown>) {
  return send("POST", "/mutate", { id: crypto.randomUUID(), name, args });
}

async function search(q: string) {
  const res = await send("GET", `/ingredients?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return (await res.json()).ingredients as {
    id: string;
    name: string;
    [key: string]: unknown;
  }[];
}

const seed = readSeed();
const seedIngredient = (name: string) => seed.ingredients.find((i) => i.name === name)!;
const spices = seed.shoppingCategories.find((c) => c.name === "Spices")!.id;

// The local database isn't reset between runs, so the test user's own rows made here are
// soft-deleted afterwards (as the e2e spec does), leaving their catalog as it was.
const created = {
  ingredients: [] as string[],
  aliases: [] as string[],
  overrides: [] as string[],
};

beforeAll(async () => {
  await loadSeed(db);
});

afterAll(async () => {
  const now = sql`now()`;
  if (created.aliases.length) {
    await db
      .update(ingredientAliases)
      .set({ deletedAt: now })
      .where(inArray(ingredientAliases.id, created.aliases));
  }
  if (created.ingredients.length) {
    await db
      .update(ingredients)
      .set({ deletedAt: now })
      .where(inArray(ingredients.id, created.ingredients));
  }
  if (created.overrides.length) {
    await db
      .update(ingredientOverrides)
      .set({ deletedAt: now })
      .where(inArray(ingredientOverrides.ingredientId, created.overrides));
  }
});

async function createOwn(name: string) {
  const ingredientId = crypto.randomUUID();
  const res = await mutate("createIngredient", {
    ingredientId,
    name,
    preferredKind: "mass",
    shoppingCategoryId: spices,
  });
  expect(res.status).toBe(200);
  created.ingredients.push(ingredientId);
  return ingredientId;
}

async function addAlias(ingredientId: string, name: string) {
  const aliasId = crypto.randomUUID();
  const res = await mutate("addAlias", { aliasId, ingredientId, name });
  created.aliases.push(aliasId);
  return res;
}

describe("GET /ingredients search", () => {
  it("finds the seed shallot when searching 'shallots'", async () => {
    const [first] = await search("shallots");
    expect(first).toMatchObject({
      name: "shallot",
      source: "seed",
      exact: true,
      matchedBy: "name",
    });
  });

  it("finds a seed Ingredient by a known alias", async () => {
    const [first] = await search("AP flour");
    expect(first).toMatchObject({
      name: "all-purpose flour",
      exact: true,
      matchedBy: "alias",
    });
  });

  it("finds a kitchen alias added with addAlias", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    expect((await addAlias(seedIngredient("shallot").id, `${tag} grey shallot`)).status).toBe(200);

    const [first] = await search(`${tag} grey shallots`);
    expect(first).toMatchObject({
      name: "shallot",
      exact: true,
      matchedBy: "alias",
    });
  });

  it("ranks a kitchen alias first over a seed alias of the same name", async () => {
    const ingredientId = await createOwn(`${crypto.randomUUID().slice(0, 8)} house cream`);
    expect((await addAlias(ingredientId, "cream")).status).toBe(200);

    const results = await search("cream");
    expect(results[0]).toMatchObject({
      id: ingredientId,
      exact: true,
      matchedBy: "alias",
    });
    expect(results).toContainEqual(expect.objectContaining({ name: "heavy cream", exact: true }));
  });

  it("never shows another owner's Ingredients", async () => {
    const name = `${crypto.randomUUID().slice(0, 8)} theirs`;
    const id = crypto.randomUUID();
    await db.insert(ingredients).values({ id, ownerId: crypto.randomUUID(), name, source: "own" });
    created.ingredients.push(id);

    expect(await search(name)).toEqual([]);
  });

  it("answers 400 for a query over 200 characters", async () => {
    const res = await send("GET", `/ingredients?q=${"a".repeat(201)}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_QUERY");
  });

  it.each(["0", "51", "1.5"])("answers 400 for limit=%s", async (limit) => {
    const res = await send("GET", `/ingredients?q=salt&limit=${limit}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_QUERY");
  });

  it("allows a kitchen alias equal to a seed name, and ranks it first", async () => {
    const ingredientId = await createOwn(`${crypto.randomUUID().slice(0, 8)} cultured butter`);
    expect((await addAlias(ingredientId, "Butter")).status).toBe(200);

    const results = await search("butter");
    expect(results[0]).toMatchObject({ id: ingredientId, exact: true, matchedBy: "alias" });
    expect(results).toContainEqual(
      expect.objectContaining({ name: "butter", source: "seed", exact: true }),
    );
  });
});

describe("overrideIngredient", () => {
  it("writes the override, leaves the seed row untouched, and search returns the overridden Main unit", async () => {
    const milk = seedIngredient("milk").id;
    const [before] = await db.select().from(ingredients).where(eq(ingredients.id, milk));

    const res = await mutate("overrideIngredient", {
      overrideId: crypto.randomUUID(),
      ingredientId: milk,
      mainUnit: "L",
    });
    created.overrides.push(milk);

    expect(res.status).toBe(200);
    expect(await db.select().from(ingredients).where(eq(ingredients.id, milk))).toEqual([before]);
    const [first] = await search("milk");
    expect(first).toMatchObject({ id: milk, mainUnit: "L", overridden: true });
    const [override] = await db
      .select({ id: ingredientOverrides.id })
      .from(ingredientOverrides)
      .where(
        and(eq(ingredientOverrides.ingredientId, milk), isNull(ingredientOverrides.deletedAt)),
      );
    expect(first?.overrideId).toBe(override?.id);
  });

  it("answers 400 for a Main unit of another kind of measure", async () => {
    const res = await mutate("overrideIngredient", {
      overrideId: crypto.randomUUID(),
      ingredientId: seedIngredient("milk").id,
      mainUnit: "kg",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_ARGS");
  });
});

describe("seed rows", () => {
  async function seedSnapshot() {
    return db.execute(
      sql`select md5(string_agg(t::text, '' order by id)) as hash from ingredients t where owner_id is null`,
    );
  }

  it("refuses createIngredient with a seed Ingredient's id", async () => {
    const before = await seedSnapshot();
    const res = await mutate("createIngredient", {
      ingredientId: seedIngredient("butter").id,
      name: `${crypto.randomUUID().slice(0, 8)} my butter`,
      preferredKind: "mass",
      shoppingCategoryId: spices,
    });
    expect(res.status).toBe(409);
    expect(await seedSnapshot()).toEqual(before);
  });

  it("refuses addAlias with a seed alias's id", async () => {
    const flour = seedIngredient("all-purpose flour");
    const [before] = await db
      .select()
      .from(ingredientAliases)
      .where(eq(ingredientAliases.id, flour.aliases[0].id));
    const res = await mutate("addAlias", {
      aliasId: flour.aliases[0].id,
      ingredientId: flour.id,
      name: `${crypto.randomUUID().slice(0, 8)} flour`,
    });
    expect(res.status).toBe(409);
    expect(
      await db
        .select()
        .from(ingredientAliases)
        .where(eq(ingredientAliases.id, flour.aliases[0].id)),
    ).toEqual([before]);
  });

  it("refuses createIngredient for a name the seed already has", async () => {
    const res = await mutate("createIngredient", {
      ingredientId: crypto.randomUUID(),
      name: "Shallots",
      preferredKind: "mass",
      shoppingCategoryId: spices,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONFLICT");
  });
});

describe("GET /shopping-categories", () => {
  it("lists the seed categories in order, then the caller's own, and hides other owners' and deleted ones", async () => {
    const token = await getToken();
    const ownerId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
      .sub as string;
    const tag = crypto.randomUUID().slice(0, 8);
    const rows = [
      { id: crypto.randomUUID(), ownerId, name: `${tag} mine`, position: "b0" },
      {
        id: crypto.randomUUID(),
        ownerId,
        name: `${tag} deleted`,
        position: "b1",
        deletedAt: new Date(),
      },
      {
        id: crypto.randomUUID(),
        ownerId: crypto.randomUUID(),
        name: `${tag} theirs`,
        position: "b2",
      },
    ];
    await db.insert(shoppingCategories).values(rows);
    try {
      const res = await send("GET", "/shopping-categories");

      expect(res.status).toBe(200);
      const names = ((await res.json()).shoppingCategories as { name: string }[]).map(
        (c) => c.name,
      );
      expect(names).toEqual([...seed.shoppingCategories.map((c) => c.name), `${tag} mine`]);
    } finally {
      await db
        .update(shoppingCategories)
        .set({ deletedAt: sql`now()` })
        .where(
          inArray(
            shoppingCategories.id,
            rows.map((row) => row.id),
          ),
        );
    }
  });
});
