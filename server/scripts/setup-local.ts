// Prepares the local Supabase stack: an ES256 signing key that Hono's jwk() can verify,
// the stack itself and a local .env.test. It creates no user: each checkout signs in as its own
// test user (scripts/test-user.ts; sign-ups are off, ADR 0008).
// Run from the repo root with `npm run setup:local`. Local development only.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { envFileName, legacyEnvWarnings, loadEnvIntoProcess } from "../../scripts/env.ts";
import { assertLocalEnv } from "../../scripts/local-only.ts";
import { supabaseStartArgs } from "./supabase-start.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const keysFile = fileURLToPath(new URL("../../supabase/signing_keys.json", import.meta.url));
const envFile = fileURLToPath(new URL("../../.env.test", import.meta.url));

function supabase(...args: string[]) {
  execFileSync("npx", ["supabase", ...args], { cwd: repoRoot, stdio: "inherit" });
}

// setup:local writes the test environment only (ADR 0012).
if (envFileName(process.env.APP_ENV) !== ".env.test")
  throw new Error("npm run setup:local writes .env.test only. Unset APP_ENV, then rerun.");
for (const warning of legacyEnvWarnings()) console.warn(`! ${warning}`);

// An existing .env.test is kept as it is, but never one with prod values.
if (existsSync(envFile)) loadEnvIntoProcess("test");
assertLocalEnv("npm run setup:local");

// 1. Signing key. The CLI only appends to an existing file, so start from an empty key set.
if (!existsSync(keysFile)) {
  writeFileSync(keysFile, "[]\n", { mode: 0o600 });
  supabase("gen", "signing-key", "--algorithm", "ES256", "--append");
}

// 2. The stack. A no-op when it is already running. CI leaves out the services its runs don't use.
supabase(...supabaseStartArgs(process.env.SUPABASE_START_EXCLUDE));

// 3. The local .env.test, from the running stack's values and a fresh random test user password.
if (existsSync(envFile)) {
  console.log("Keeping the existing .env.test.");
} else {
  const status = JSON.parse(
    execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    }),
  ) as { DB_URL: string; API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };
  const values = {
    DATABASE_URL: status.DB_URL,
    SUPABASE_URL: status.API_URL,
    SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  };
  const lines = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  writeFileSync(
    envFile,
    `# Written by \`npm run setup:local\` for the local Supabase stack only.\n${lines.join("\n")}\n`,
    { mode: 0o600 },
  );
  loadEnvIntoProcess("test");
  console.log("Wrote .env.test for the local stack.");
}
