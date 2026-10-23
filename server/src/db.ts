import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Only the server reaches Postgres, through Drizzle (ADR 0006).
// Source: https://orm.drizzle.team/docs/get-started-postgresql#postgresjs
// Prepared statements stay on, so a cloud DATABASE_URL must use the session pooler (README).
export function createDb(url: string) {
  return drizzle({ client: postgres(url, { onnotice: () => {} }) });
}

export type Db = ReturnType<typeof createDb>;
