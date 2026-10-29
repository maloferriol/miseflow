// Loads the shared Ingredient seed (server/seed/ingredient-seed.json) into the database.
// Idempotent: a second run writes nothing. Run with `npm run seed -w server`.
import "../../scripts/load-env.ts";
import { createDb } from "../src/db.ts";
import { databaseUrlFromEnv } from "../src/env.ts";
import { loadSeed } from "../src/seed.ts";

const db = createDb(databaseUrlFromEnv());
try {
  const result = await loadSeed(db);
  console.log(
    `seed: ${result.shoppingCategories} shopping categories, ${result.ingredients} ingredients, ` +
      `${result.aliases} aliases, ${result.conversions} conversions; ${result.written} written`,
  );
} finally {
  await db.$client.end();
}
