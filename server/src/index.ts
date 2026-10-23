import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createDb } from "./db.ts";
import { authConfigFromEnv, databaseUrlFromEnv, kitchenTimeZoneFromEnv } from "./env.ts";

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
