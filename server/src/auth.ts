import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { jwk } from "hono/jwk";
import type { JwtVariables } from "hono/jwt";

export type AuthConfig = {
  /** The Supabase Auth URL, `<SUPABASE_URL>/auth/v1`; the tokens' `iss`. */
  issuer: string;
};

export type AuthEnv = { Variables: JwtVariables & { ownerId: string } };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Checks the Supabase access token against the project's published keys, without calling
// Supabase per user (ADR 0008), then exposes its `sub` as `ownerId`.
// Source: https://hono.dev/docs/middleware/builtin/jwk
export function requireAuth({ issuer }: AuthConfig): MiddlewareHandler<AuthEnv> {
  const verifyToken = jwk({
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    alg: ["ES256", "RS256"],
    verification: { iss: issuer, aud: "authenticated" },
  });
  return async (c, next) =>
    verifyToken(c, async () => {
      const ownerId: unknown = c.get("jwtPayload")?.sub;
      if (typeof ownerId !== "string" || !uuidPattern.test(ownerId)) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      c.set("ownerId", ownerId);
      await next();
    });
}
