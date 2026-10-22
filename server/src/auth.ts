import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { jwk } from "hono/jwk";
import { decode, type JwtVariables } from "hono/jwt";

/** A public JSON Web Key as `jwk()` takes it. */
export type Jwk = JsonWebKey & { kid?: string };

/** Returns the keys to verify a token with; `kid` is the token's key id, when it has one. */
export type KeySource = (kid: string | undefined) => Promise<Jwk[]>;

export type AuthConfig = {
  /** The Supabase Auth URL, `<SUPABASE_URL>/auth/v1`; the tokens' `iss`. */
  issuer: string;
  /** Defaults to the issuer's JWKS, cached. Tests inject keys they sign with. */
  keys?: KeySource;
};

export type AuthEnv = { Variables: JwtVariables & { ownerId: string } };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Checks the Supabase access token against the project's published keys, without calling
// Supabase per user (ADR 0008), then exposes its `sub` as `ownerId`. The keys come from a
// cache, so the JWKS is fetched once per TTL rather than on every request.
// Source: https://hono.dev/docs/middleware/builtin/jwk (`keys` may be a function of the context)
export function requireAuth({
  issuer,
  keys,
}: AuthConfig): MiddlewareHandler<AuthEnv> {
  const keySource = keys ?? sharedJwksCache(`${issuer}/.well-known/jwks.json`);
  const verifyToken = jwk({
    keys: (c) => keySource(tokenKid(c)),
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

// The `kid` of the bearer token, or undefined when there is none or it doesn't decode;
// `jwk()` then rejects the token itself.
function tokenKid(c: Context): string | undefined {
  const token = c.req.header("Authorization")?.split(/\s+/)[1];
  if (!token) return undefined;
  try {
    const kid: unknown = decode(token).header.kid;
    return typeof kid === "string" ? kid : undefined;
  } catch {
    return undefined;
  }
}

const TTL_MS = 10 * 60_000;
// Fetches are at least this far apart once keys are cached, counted from the last attempt,
// failed or not: forged kids and a down endpoint can't make every request fetch the JWKS.
const REFETCH_COOLDOWN_MS = 30_000;

// Caches a JWKS for TTL_MS, refetches early for an unknown kid (key rotation), and shares one
// in-flight fetch between concurrent requests. A failed refetch keeps serving the old keys.
export function createJwksCache(
  url: string,
  {
    fetch = globalThis.fetch,
    now = Date.now,
  }: { fetch?: (url: string) => Promise<Response>; now?: () => number } = {},
): KeySource {
  let keys: Jwk[] | undefined;
  let fetchedAt = 0;
  let attemptedAt = 0;
  let inFlight: Promise<Jwk[]> | undefined;

  const load = async (): Promise<Jwk[]> => {
    attemptedAt = now();
    try {
      const res = await fetch(url);
      if (!res.ok)
        throw new Error(`Failed to fetch JWKS from ${url}: ${res.status}`);
      const body: { keys?: unknown } = await res.json();
      if (!Array.isArray(body.keys))
        throw new Error(`Invalid JWKS from ${url}: no keys array`);
      keys = body.keys as Jwk[];
      fetchedAt = now();
      return keys;
    } catch (error) {
      if (keys) return keys;
      throw error;
    }
  };

  // Assigned before it is cleared, even when `fetch` throws synchronously.
  const refresh = () => {
    if (!inFlight) {
      const pending = load();
      inFlight = pending;
      pending
        .finally(() => {
          inFlight = undefined;
        })
        .catch(() => {});
    }
    return inFlight;
  };

  return async (kid) => {
    if (!keys) return refresh();
    if (now() - attemptedAt < REFETCH_COOLDOWN_MS) return keys;
    const expired = now() - fetchedAt >= TTL_MS;
    const unknownKid =
      kid !== undefined && !keys.some((key) => key.kid === kid);
    return expired || unknownKid ? refresh() : keys;
  };
}

const jwksCaches = new Map<string, KeySource>();

// One cache per JWKS URL for the whole process, shared by every app instance.
function sharedJwksCache(url: string): KeySource {
  let cache = jwksCaches.get(url);
  if (!cache) jwksCaches.set(url, (cache = createJwksCache(url)));
  return cache;
}
