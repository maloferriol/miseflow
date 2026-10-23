import { describe, expect, it } from "vitest";
import { createJwksCache } from "../src/auth.ts";

const url = "http://auth.test/.well-known/jwks.json";

// A JWKS endpoint that counts its fetches and serves whatever `kids` holds at the time, or a
// 503 while `down`.
function fakeJwks(kids: string[]) {
  const server = { kids, fetches: 0, down: false };
  const fetch = async () => {
    server.fetches += 1;
    if (server.down) return new Response("unavailable", { status: 503 });
    return new Response(
      JSON.stringify({ keys: server.kids.map((kid) => ({ kid, kty: "EC" })) }),
    );
  };
  return { server, fetch };
}

describe("JWKS cache", () => {
  it("fetches the keys once for repeated lookups within the TTL", async () => {
    const { server, fetch } = fakeJwks(["k1"]);
    const keys = createJwksCache(url, { fetch, now: () => 0 });

    await keys("k1");
    await keys("k1");

    expect(server.fetches).toBe(1);
  });

  it("refetches once the TTL has passed", async () => {
    const { server, fetch } = fakeJwks(["k1"]);
    let now = 0;
    const keys = createJwksCache(url, { fetch, now: () => now });

    await keys("k1");
    now = 11 * 60_000;
    await keys("k1");

    expect(server.fetches).toBe(2);
  });

  it("refetches for an unknown kid, so a rotated key is picked up", async () => {
    const { server, fetch } = fakeJwks(["k1"]);
    let now = 0;
    const keys = createJwksCache(url, { fetch, now: () => now });
    await keys("k1");

    server.kids = ["k1", "k2"];
    now = 60_000;
    const found = await keys("k2");

    expect(found.map((key) => key.kid)).toContain("k2");
    expect(server.fetches).toBe(2);
  });

  it("does not refetch for unknown kids more than once per cooldown", async () => {
    const { server, fetch } = fakeJwks(["k1"]);
    const keys = createJwksCache(url, { fetch, now: () => 0 });
    await keys("k1");

    await keys("forged-1");
    await keys("forged-2");

    expect(server.fetches).toBe(1);
  });

  it("shares one in-flight fetch between concurrent lookups", async () => {
    const { server, fetch } = fakeJwks(["k1"]);
    const keys = createJwksCache(url, { fetch, now: () => 0 });

    await Promise.all([keys("k1"), keys("k1"), keys("k1")]);

    expect(server.fetches).toBe(1);
  });

  it("retries after a fetch that throws synchronously", async () => {
    const { server, fetch: serve } = fakeJwks(["k1"]);
    let calls = 0;
    const fetch = (): Promise<Response> => {
      calls += 1;
      if (calls === 1) throw new Error("synchronous failure");
      return serve();
    };
    const keys = createJwksCache(url, { fetch, now: () => 0 });

    await expect(keys("k1")).rejects.toThrow("synchronous failure");
    const found = await keys("k1");

    expect(found.map((key) => key.kid)).toEqual(["k1"]);
    expect(server.fetches).toBe(1);
  });

  it("serves stale keys after a failed refetch and does not retry inside the cooldown", async () => {
    const { server, fetch } = fakeJwks(["k1"]);
    let now = 0;
    const keys = createJwksCache(url, { fetch, now: () => now });
    await keys("k1");

    server.down = true;
    now = 11 * 60_000;
    const stale = await keys("k1");
    now += 1_000;
    await keys("k1");
    await keys("forged");

    expect(stale.map((key) => key.kid)).toEqual(["k1"]);
    expect(server.fetches).toBe(2);
  });

  it("times out a fetch that hangs and serves the stale keys", async () => {
    const { server, fetch: serve } = fakeJwks(["k1"]);
    let hang = false;
    // Never answers while `hang` is set; only the abort signal ends it.
    const fetch = (_url: string, init?: RequestInit): Promise<Response> =>
      hang
        ? new Promise((_, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
          )
        : serve();
    let now = 0;
    const keys = createJwksCache(url, { fetch, now: () => now, timeoutMs: 20 });
    await keys("k1");

    hang = true;
    now = 11 * 60_000;
    const stale = await keys("k1");

    expect(stale.map((key) => key.kid)).toEqual(["k1"]);
    expect(server.fetches).toBe(1);
  }, 1_000);

  it("throws on a cold failure and caches nothing", async () => {
    const { server, fetch } = fakeJwks(["k1"]);
    const keys = createJwksCache(url, { fetch, now: () => 0 });

    server.down = true;
    await expect(keys("k1")).rejects.toThrow("503");
    server.down = false;
    const found = await keys("k1");

    expect(found.map((key) => key.kid)).toEqual(["k1"]);
    expect(server.fetches).toBe(2);
  });

  it("drops a key removed from the JWKS once the TTL has passed", async () => {
    const { server, fetch } = fakeJwks(["k1", "k2"]);
    let now = 0;
    const keys = createJwksCache(url, { fetch, now: () => now });
    await keys("k1");

    server.kids = ["k1"];
    now = 11 * 60_000;
    const found = await keys("k1");

    expect(found.map((key) => key.kid)).toEqual(["k1"]);
  });

  it("makes concurrent lookups for a new kid wait for the pending refetch", async () => {
    const { server, fetch: serve } = fakeJwks(["k1"]);
    let release: () => void = () => {};
    let delay = false;
    // While `delay` is set, answers only once `release` is called.
    const fetch = async (): Promise<Response> => {
      if (delay) await new Promise<void>((resolve) => (release = resolve));
      return serve();
    };
    let now = 0;
    const keys = createJwksCache(url, { fetch, now: () => now });
    await keys("k1");

    server.kids = ["k1", "k2"];
    delay = true;
    now = 60_000;
    const lookups = Promise.all([keys("k2"), keys("k2"), keys("k2")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const found = await lookups;

    for (const result of found) expect(result.map((key) => key.kid)).toContain("k2");
    expect(server.fetches).toBe(2);
  });
});
