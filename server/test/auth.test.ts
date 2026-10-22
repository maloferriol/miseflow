import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
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
