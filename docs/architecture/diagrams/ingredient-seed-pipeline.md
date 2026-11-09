# Ingredient seed pipeline

```mermaid
flowchart TD
  A["npm run seed -w server<br/>(tsx scripts/seed.ts)"] --> C
  B["npm run db:seed:prod<br/>(APP_ENV=prod npm run seed -w server)"] --> C
  C["scripts/load-env.ts<br/>loadEnvIntoProcess()"] --> C1{"envFileName(APP_ENV)<br/>.env.test or .env.prod exists?"}
  C1 -- "unknown APP_ENV / file missing" --> X1(["throw: process exits"])
  C1 -- ok --> D["server/scripts/seed.ts<br/>createDb(databaseUrlFromEnv())"]
  D --> E["loadSeed(db, seed = readSeed())"]

  subgraph READ ["readSeed(dir) in server/src/seed.ts"]
    R1["seed/seed.json<br/>headSchema.parse: licence, shoppingCategories"] --> R2{"every seed/ingredients/*.json<br/>is categoryFile(name) of a category?"}
    R2 -- no --> F1(["throw: file names no Shopping category"])
    R2 -- yes --> R3["claim(id) for each Shopping category"]
    R3 --> R4["per category file, in category order:<br/>z.array(ingredientSchema).parse"]
    R4 --> R5{"ingredient.shoppingCategory<br/>matches its file?"}
    R5 -- no --> F2(["throw: wrong category file"])
    R5 -- yes --> R6{"claim(id) for ingredient,<br/>aliases, conversions: unique?"}
    R6 -- no --> F3(["throw: id appears twice"])
    R6 -- yes --> R7{"normaliseName(name and aliases)<br/>clash with another ingredient?"}
    R7 -- yes --> F4(["throw: names match"])
    R7 -- no --> R8["Seed: licence, shoppingCategories, ingredients"]
  end

  E --> R1
  R1 -. "zod parse error" .-> F0(["throw: ZodError"])
  R8 --> L1["build rows: categoryRows (positionAfter),<br/>ingredientRows, aliasRows, conversionRows<br/>ownerId null, source 'seed', deletedAt null"]

  subgraph TX ["db.transaction: upsert() per table, in order"]
    T1["shopping_categories"] --> T2["ingredients"] --> T3["ingredient_aliases"] --> T4["conversions"]
  end

  L1 --> T1
  T1 -. "each upsert" .-> U["insert ... on conflict (id) do update<br/>set columns = excluded, updated_at = now()<br/>where owner_id is null and columns is distinct from excluded"]
  U --> U2{"any of these ids has<br/>owner_id not null?"}
  U2 -- yes --> F5(["throw: id belongs to a user<br/>transaction rolls back"])
  T4 --> P["console.log: categories, ingredients,<br/>aliases, conversions counts; written"]
  P --> Z["finally: db.$client.end()"]
  F5 --> Z
```

## How it works

`server/scripts/seed.ts` imports `scripts/load-env.ts` first, which loads exactly one env file picked by `APP_ENV` (`.env.test` when unset or `test`, `.env.prod` for `db:seed:prod`), then opens the database with `DATABASE_URL`. `loadSeed(db)` calls `readSeed()` on `server/seed/`: `seed.json` holds the ODbL licence notice and the ordered Shopping categories, and `ingredients/<slug>.json` holds one category's Ingredients (slug from `categoryFile`, e.g. "Meat & fish" becomes `meat-and-fish.json`). Every file is checked with zod strict schemas; `readSeed` also throws on a JSON file that names no category, an Ingredient in the wrong category file, any id used twice across categories, Ingredients, aliases and Conversions (`claim`), and two Ingredients whose names or aliases match after `normaliseName`.

`loadSeed` turns the seed into rows with `ownerId: null`, `source: "seed"` and `deletedAt: null` (categories get a fractional `position` from `positionAfter`), then upserts all four tables in one transaction. After each insert, `upsert` checks whether any of those ids belongs to a user row (`owner_id is not null`); if so it throws and the whole transaction rolls back. Either way the script closes the connection in `finally`; a thrown error ends the run with a non-zero exit.

**Idempotency:** a conflicting row is only rewritten when it has no owner and its columns differ from the file, so a second run writes nothing, `written` is 0 and `updated_at` is kept.

**Rows removed from the seed** are left alone: nothing deletes or soft-deletes database rows whose ids no longer appear in the files.

## Source files

- [server/scripts/seed.ts](../../../server/scripts/seed.ts)
- [server/src/seed.ts](../../../server/src/seed.ts)
- [server/src/env.ts](../../../server/src/env.ts)
- [scripts/load-env.ts](../../../scripts/load-env.ts)
- [scripts/env.ts](../../../scripts/env.ts)
- [server/package.json](../../../server/package.json)
- [package.json](../../../package.json)
- [server/seed/seed.json](../../../server/seed/seed.json)
- [server/seed/ingredients/](../../../server/seed/ingredients/)
- [docs/adr/0003-ingredient-seed-published-under-odbl.md](../../adr/0003-ingredient-seed-published-under-odbl.md)
