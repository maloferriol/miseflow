import { sign } from "hono/jwt";
import { beforeAll, describe, expect, it } from "vitest";
import { getToken, issuer, testApp } from "./helpers.ts";

const mutateWith = (headers: Record<string, string>) =>
  testApp().request("/mutate", { method: "POST", body: "{}", headers });

describe("auth", () => {
  it("POST /mutate with no Authorization header returns 401", async () => {
    const res = await testApp().request("/mutate", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed bearer token with 401", async () => {
    const res = await mutateWith({ Authorization: "Bearer garbage" });
    expect(res.status).toBe(401);
  });

  it("rejects a token signed by a different ES256 key with 401", async () => {
    const { keys } = await (await fetch(`${issuer}/.well-known/jwks.json`)).json();
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const forged = await sign(
      {
        sub: crypto.randomUUID(),
        iss: issuer,
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      { ...privateJwk, kid: keys[0].kid, alg: "ES256" },
      "ES256",
    );
    const res = await mutateWith({ Authorization: `Bearer ${forged}` });
    expect(res.status).toBe(401);
  });

  it("lets a valid Supabase access token through", async () => {
    const res = await mutateWith({ Authorization: `Bearer ${await getToken()}` });
    expect(res.status).not.toBe(401);
  });

  it("keeps GET /health public", async () => {
    const res = await testApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("auth claims", () => {
  // A key pair of our own, handed to the app through AuthConfig.keys, so tests can sign tokens
  // with any claims.
  const kid = "test-key";
  let privateJwk: JsonWebKey;
  let app: ReturnType<typeof testApp>;

  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    app = testApp({
      auth: { issuer, keys: () => Promise.resolve([{ ...publicJwk, kid, alg: "ES256" }]) },
    });
  });

  const valid = () => ({
    sub: crypto.randomUUID(),
    iss: issuer,
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 600,
  });

  async function mutateAs(claims: Record<string, unknown>) {
    const token = await sign(claims, { ...privateJwk, kid, alg: "ES256" }, "ES256");
    return app.request("/mutate", {
      method: "POST",
      body: "{}",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
  }

  it("lets a token with valid claims through", async () => {
    expect((await mutateAs(valid())).status).not.toBe(401);
  });

  it("rejects a token from another issuer with 401", async () => {
    expect((await mutateAs({ ...valid(), iss: "http://evil.test/auth/v1" })).status).toBe(401);
  });

  it("rejects a token for another audience with 401", async () => {
    expect((await mutateAs({ ...valid(), aud: "anon" })).status).toBe(401);
  });

  it("rejects an expired token with 401", async () => {
    expect((await mutateAs({ ...valid(), exp: Math.floor(Date.now() / 1000) - 60 })).status).toBe(
      401,
    );
  });

  it("rejects a token without a sub with 401", async () => {
    const { sub: _sub, ...claims } = valid();
    expect((await mutateAs(claims)).status).toBe(401);
  });

  it("rejects a token whose sub is not a uuid with 401", async () => {
    expect((await mutateAs({ ...valid(), sub: "user-1" })).status).toBe(401);
  });
});
