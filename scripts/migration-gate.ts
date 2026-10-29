// The decisions behind `npm run db:migrate:prod` (scripts/db-migrate-prod.ts) and the prod server's
// start-up gate (#209). The scripts gather the facts (journal, applied rows, typed text); these decide.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** One drizzle journal entry: `tag` is the migration's name, `when` its folderMillis. */
export type Migration = { tag: string; when: number };

const defaultJournal = fileURLToPath(
  new URL("../shared/migrations/meta/_journal.json", import.meta.url),
);

/** The migrations the repo ships, in order, from drizzle's journal. */
export function readAvailableMigrations(journalPath = defaultJournal): Migration[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Migration[] };
  return journal.entries.map(({ tag, when }) => ({ tag, when }));
}

/** The shape of a postgres.js client that this file needs: a tagged-template query. */
type Query = (strings: TemplateStringsArray) => PromiseLike<Record<string, unknown>[]>;

/**
 * The `created_at` of every applied migration (drizzle stores the journal's `when` there). Empty
 * when drizzle's table does not exist yet (a database that never ran a migration).
 */
export async function readAppliedMigrations(sql: Query): Promise<number[]> {
  try {
    const rows = await sql`select created_at from drizzle.__drizzle_migrations`;
    return rows.map((row) => Number(row.created_at));
  } catch (error) {
    // 42P01 / 3F000: the table or its schema is missing.
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "3F000") return [];
    throw error;
  }
}

/**
 * Names of the migrations that still have to run. Like drizzle-kit, a migration is pending when it
 * is newer than the last applied one.
 */
export function pendingMigrations(available: Migration[], appliedCreatedAt: number[]): string[] {
  const lastApplied = Math.max(-Infinity, ...appliedCreatedAt);
  return available.filter((migration) => migration.when > lastApplied).map(({ tag }) => tag);
}

/**
 * The project ref (or host) of a Supabase URL. Only this is ever printed: DATABASE_URL carries the
 * password, so it is never passed here.
 */
export function projectRef(supabaseUrl: string): string {
  if (!URL.canParse(supabaseUrl)) return "an unparseable URL";
  const { hostname } = new URL(supabaseUrl);
  return hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : hostname;
}

export type ProdMigrationDecision =
  | { action: "nothing-to-do" }
  | { action: "confirm" }
  | { action: "confirmed" }
  | { action: "refused" };

/**
 * What `db:migrate:prod` does next. `typed` is what the developer typed back, undefined before they
 * were asked. Applying happens only on "confirmed".
 */
export function prodMigrationDecision(input: {
  ref: string;
  pending: string[];
  typed?: string;
}): ProdMigrationDecision {
  if (input.pending.length === 0) return { action: "nothing-to-do" };
  if (input.typed === undefined) return { action: "confirm" };
  return input.typed.trim() === input.ref ? { action: "confirmed" } : { action: "refused" };
}

/**
 * The prod server's start-up check: reads what prod has applied and returns the refusal message, or
 * undefined when the server may start. A failed read is rethrown without the driver's message,
 * which can carry the connection string and so the database password.
 */
export async function prodStartupCheck(
  sql: Query,
  available: Migration[],
): Promise<string | undefined> {
  let applied: number[];
  try {
    applied = await readAppliedMigrations(sql);
  } catch {
    throw new Error(
      "Could not read the applied migrations from prod. Check DATABASE_URL in .env.prod.",
    );
  }
  return prodStartupProblem(pendingMigrations(available, applied));
}

/** For the server started with APP_ENV=prod: a message naming the pending migrations, or undefined. */
export function prodStartupProblem(pending: string[]): string | undefined {
  if (pending.length === 0) return undefined;
  return (
    `Prod has ${pending.length} migration(s) waiting: ${pending.join(", ")}. ` +
    "Run `npm run db:migrate:prod`, then start the server again."
  );
}
