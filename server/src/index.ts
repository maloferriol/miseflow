import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { authConfigFromEnv } from "./auth.ts";
import { createDb, databaseUrlFromEnv } from "./db.ts";

const app = createApp({ auth: authConfigFromEnv(), db: createDb(databaseUrlFromEnv()) });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`MiseFlow API listening on http://localhost:${info.port}`);
});

export type { AppType } from "./app.ts";
