import { mutators as defaultMutators, type Mutator } from "@miseflow/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AuthConfig, type AuthEnv, requireAuth } from "./auth.ts";
import type { Db } from "./db.ts";
import { errorBody } from "./errors.ts";
import { ingredientsRoute } from "./routes/ingredients.ts";
import { availabilityRoute } from "./routes/availability.ts";
import { menusRoute } from "./routes/menus.ts";
import { mutateRoute } from "./routes/mutate.ts";
import { recipesRoute } from "./routes/recipes.ts";
import { servicesRoute } from "./routes/services.ts";
import { shoppingCategoriesRoute } from "./routes/shopping-categories.ts";

export type AppOptions = {
  auth: AuthConfig;
  db: Db;
  /** Defaults to every mutator in `shared`. Tests inject extra ones. */
  mutators?: Record<string, Mutator<any>>;
  /** The kitchen's IANA time zone (D2). */
  timeZone: string;
  /** The server's clock, for Step events and behind (#88). Tests inject a fixed one. */
  now?: () => Date;
};

export function createApp({ auth, db, mutators = defaultMutators, timeZone, now = () => new Date() }: AppOptions) {
  const app = new Hono<AuthEnv>()
    // Public. Registered before the auth middleware, which guards every other route.
    .get("/health", (c) => c.json({ ok: true }))
    .use("*", requireAuth(auth))
    .route("/mutate", mutateRoute(db, mutators, timeZone, now))
    .route("/menus", menusRoute(db))
    .route("/recipes", recipesRoute(db))
    .route("/ingredients", ingredientsRoute(db))
    .route("/shopping-categories", shoppingCategoriesRoute(db))
    .route("/services", servicesRoute(db, timeZone, now))
    .route("/availability", availabilityRoute(db, timeZone));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    // Details stay in the server log, never in the response.
    console.error(error);
    return c.json(errorBody("INTERNAL", "Internal error"), 500);
  });
  return app;
}

export type AppType = ReturnType<typeof createApp>;
