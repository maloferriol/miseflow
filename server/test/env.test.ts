import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEnv, legacyEnvWarnings, loadEnv, viteEnv } from "../../scripts/env.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "env-loader-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const write = (name: string, body: string) => writeFileSync(join(root, name), body);

describe("env loader", () => {
  it.each([undefined, "", "test"])("reads .env.test when APP_ENV is %j", (appEnv) => {
    write(".env.test", "SUPABASE_URL=http://127.0.0.1:54321\n");
    write(".env.prod", "SUPABASE_URL=https://ref.supabase.co\nONLY_PROD=1\n");

    expect(loadEnv(appEnv, root)).toEqual({ SUPABASE_URL: "http://127.0.0.1:54321" });
  });

  it("reads .env.prod when APP_ENV is prod, and nothing from .env.test", () => {
    write(".env.test", "SUPABASE_URL=http://127.0.0.1:54321\nONLY_TEST=1\n");
    write(".env.prod", "SUPABASE_URL=https://ref.supabase.co\n");

    expect(loadEnv("prod", root)).toEqual({ SUPABASE_URL: "https://ref.supabase.co" });
  });

  it("throws for an unknown APP_ENV and names the allowed values", () => {
    write(".env.test", "A=1\n");

    expect(() => loadEnv("staging", root)).toThrow(/APP_ENV.*"staging".*test.*prod/s);
  });

  it("throws for a missing file and names the fix, without any value", () => {
    write(".env.prod", "DATABASE_URL=postgresql://u:hunter2@host/db\n");

    let message = "";
    try {
      loadEnv("test", root);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/\.env\.test.*npm run setup:local/s);
    expect(message).not.toContain("hunter2");
    expect(() => loadEnv("prod", join(root, "nowhere"))).toThrow(/\.env\.prod/);
  });

  it("applyEnv fills process.env without overriding what the shell already set", () => {
    const target: NodeJS.ProcessEnv = { KEEP: "shell" };

    applyEnv({ KEEP: "file", NEW: "file" }, target);

    expect(target).toEqual({ KEEP: "shell", NEW: "file" });
  });

  it("viteEnv exposes only VITE_ values, with the shell winning", () => {
    write(".env.test", "VITE_A=file\nVITE_B=file\nSUPABASE_SECRET_KEY=secret\n");

    expect(viteEnv(undefined, root, { VITE_B: "shell", OTHER: "x" })).toEqual({
      VITE_A: "file",
      VITE_B: "shell",
    });
  });

  it("reports a leftover .env or .env.local with the fix, and renames nothing", () => {
    expect(legacyEnvWarnings(root)).toEqual([]);
    write(".env", "A=1\n");
    write(".env.local", "B=2\n");

    const warnings = legacyEnvWarnings(root);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^\.env\b.*\.env\.test/);
    expect(warnings[1]).toMatch(/^\.env\.local.*\.env\.prod/);
  });
});
