import { mutators as defaultMutators, type Mutator } from "@miseflow/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AuthConfig, type AuthEnv, requireAuth } from "./auth.ts";
import type { Db } from "./db.ts";
import { errorBody } from "./errors.ts";
import { mutateRoute } from "./routes/mutate.ts";

export type AppOptions = {
  auth: AuthConfig;
  db: Db;
  /** Defaults to every mutator in `shared`. Tests inject extra ones. */
  mutators?: Record<string, Mutator<any>>;
};

export function createApp({ auth, db, mutators = defaultMutators }: AppOptions) {
  const app = new Hono<AuthEnv>()
    // Public. Registered before the auth middleware, which guards every other route.
    .get("/health", (c) => c.json({ ok: true }))
    .use("*", requireAuth(auth))
    .route("/mutate", mutateRoute(db, mutators));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    // Details stay in the server log, never in the response.
    console.error(error);
    return c.json(errorBody("INTERNAL", "Internal error"), 500);
  });
  return app;
}

export type AppType = ReturnType<typeof createApp>;
