import "../../scripts/load-env.ts";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createDb } from "./db.ts";
import { prodStartupRefusal } from "./prod-gate.ts";
import { authConfigFromEnv, databaseUrlFromEnv, kitchenTimeZoneFromEnv } from "./env.ts";

const refusal = await prodStartupRefusal(process.env.APP_ENV);
if (refusal) {
  console.error(refusal);
  process.exit(1);
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
