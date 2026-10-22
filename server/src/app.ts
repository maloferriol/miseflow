import { Hono } from "hono";
import { type AuthConfig, type AuthEnv, requireAuth } from "./auth.ts";

export type AppOptions = { auth: AuthConfig };

export function createApp({ auth }: AppOptions) {
  return (
    new Hono<AuthEnv>()
      // Public. Registered before the auth middleware, which guards every other route.
      .get("/health", (c) => c.json({ ok: true }))
      .use("*", requireAuth(auth))
  );
}

export type AppType = ReturnType<typeof createApp>;
