import { afterEach, describe, expect, it, vi } from "vitest";
import checkDatabase from "./global-setup.ts";

// The global setup is the guard: it must refuse prod values before it connects to anything.
describe("test global setup", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a DATABASE_URL that is not on the local stack, without naming its password", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres.ref:hunter2@aws-0-eu-north-1.pooler.supabase.com:5432/postgres",
    );

    const error = await checkDatabase().catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /only against the local Supabase stack.*aws-0-eu-north-1\.pooler\.supabase\.com/,
    );
    expect((error as Error).message).toMatch(/prod/);
    expect((error as Error).message).toMatch(/\.env\.test/);
    expect((error as Error).message).not.toContain("hunter2");
  });

  it("refuses a SUPABASE_URL that is not on the local stack", async () => {
    vi.stubEnv("SUPABASE_URL", "https://ref.supabase.co");

    await expect(checkDatabase()).rejects.toThrow(/SUPABASE_URL points at ref\.supabase\.co/);
  });

  it("refuses a VITE_SUPABASE_URL that is not on the local stack", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://ref.supabase.co");

    await expect(checkDatabase()).rejects.toThrow(/VITE_SUPABASE_URL points at ref\.supabase\.co/);
  });
});
