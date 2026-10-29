import "../../scripts/load-env.ts";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createDb } from "./db.ts";
import postgres from "postgres";
import { prodStartupCheck, readAvailableMigrations } from "../../scripts/migration-gate.ts";
import { authConfigFromEnv, databaseUrlFromEnv, kitchenTimeZoneFromEnv } from "./env.ts";

// Against prod the server refuses to start on an old schema (ADR 0012). Prints no connection string.
if (process.env.APP_ENV === "prod") {
  const sql = postgres(databaseUrlFromEnv(), { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    const problem = await prodStartupCheck(sql, readAvailableMigrations());
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not check prod's migrations.");
    process.exit(1);
  } finally {
    await sql.end();
  }
}

const app = createApp({
  auth: authConfigFromEnv(),
  db: createDb(databaseUrlFromEnv()),
  timeZone: kitchenTimeZoneFromEnv(),
});
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`MiseFlow API listening on http://localhost:${info.port}`);
});

export type { AppType } from "./app.ts";
