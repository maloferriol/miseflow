import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Only the server reaches Postgres, through Drizzle (ADR 0006).
// Source: https://orm.drizzle.team/docs/get-started-postgresql#postgresjs
export function createDb(url: string) {
  return drizzle({ client: postgres(url, { onnotice: () => {} }) });
}

export type Db = ReturnType<typeof createDb>;

export function databaseUrlFromEnv(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  return url;
}
