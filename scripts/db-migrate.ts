// `npm run db:migrate` (test, the local stack only) and `npm run db:migrate:prod` (deliberate).
// Prod: loads .env.prod, prints the project ref and the waiting migrations, asks for the ref to be
// typed back, then applies through drizzle-kit. The decisions are in migration-gate.ts; this script
// only gathers facts. Never prints DATABASE_URL (it carries the password).
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { loadEnvIntoProcess } from "./env.ts";
import { assertLocalEnv } from "./local-only.ts";
import {
  pendingMigrations,
  projectRef,
  prodMigrationDecision,
  readAppliedMigrations,
  readAvailableMigrations,
  withMigrationSql,
} from "./migration-gate.ts";

const target = process.argv[2];
if (target !== "test" && target !== "prod") {
  console.error("Usage: db-migrate.ts <test|prod>");
  process.exit(1);
}

function applyWithDrizzleKit(): never {
  const result = spawnSync("npx", ["drizzle-kit", "migrate"], {
    cwd: fileURLToPath(new URL("../shared", import.meta.url)),
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

try {
  // The target is fixed by the command, not by the caller's shell.
  process.env.APP_ENV = target;
  loadEnvIntoProcess();

  if (target === "test") {
    assertLocalEnv("npm run db:migrate");
    applyWithDrizzleKit();
  }

  const url = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!url || !supabaseUrl)
    throw new Error("DATABASE_URL and SUPABASE_URL must be set in .env.prod.");
  const ref = projectRef(supabaseUrl);

  const pending = await withMigrationSql(url, async (sql) =>
    pendingMigrations(readAvailableMigrations(), await readAppliedMigrations(sql)),
  );

  console.log(`Prod project: ${ref}`);
  if (prodMigrationDecision({ ref, pending }).action === "nothing-to-do") {
    console.log("Nothing pending: prod is up to date.");
    process.exit(0);
  }
  console.log(`Migrations waiting (${pending.length}):`);
  for (const name of pending) console.log(`  ${name}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question(`Type the project ref (${ref}) to apply them: `);
  rl.close();
  if (prodMigrationDecision({ ref, pending, typed }).action !== "confirmed") {
    console.error("The typed ref does not match. Nothing was applied.");
    process.exit(1);
  }
  applyWithDrizzleKit();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
