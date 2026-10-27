// Prepares the local Supabase stack: an ES256 signing key that Hono's jwk() can verify,
// the stack itself, a local .env, and the single test user (sign-ups are off, ADR 0008).
// Run from the repo root with `npm run setup:local`. Local development only.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertLocalEnv } from "../../scripts/local-only.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const keysFile = fileURLToPath(new URL("../../supabase/signing_keys.json", import.meta.url));
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));

function supabase(...args: string[]) {
  execFileSync("npx", ["supabase", ...args], { cwd: repoRoot, stdio: "inherit" });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set in .env. Delete .env and rerun to write a fresh one.`);
  return value;
}

// An existing .env is kept as it is, but never one with cloud values: this seeds a test user.
assertLocalEnv("npm run setup:local");

// 1. Signing key. The CLI only appends to an existing file, so start from an empty key set.
if (!existsSync(keysFile)) {
  writeFileSync(keysFile, "[]\n", { mode: 0o600 });
  supabase("gen", "signing-key", "--algorithm", "ES256", "--append");
}

// 2. The stack. A no-op when it is already running.
supabase("start");

// 3. The local .env, from the running stack's values and a fresh random test user password.
if (existsSync(envFile)) {
  console.log("Keeping the existing .env.");
} else {
  const status = JSON.parse(
    execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    }),
  );
  const values = {
    DATABASE_URL: status.DB_URL,
    SUPABASE_URL: status.API_URL,
    SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    TEST_USER_EMAIL: "cook@miseflow.test",
    TEST_USER_PASSWORD: randomBytes(18).toString("base64url"),
  };
  const lines = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  writeFileSync(
    envFile,
    `# Written by \`npm run setup:local\` for the local Supabase stack only.\n${lines.join("\n")}\n`,
    { mode: 0o600 },
  );
  process.loadEnvFile(envFile);
  console.log("Wrote .env for the local stack.");
}

// 4. The test user, created confirmed. Re-running resets the password to the one in .env.
const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = requireEnv("TEST_USER_EMAIL");
const password = requireEnv("TEST_USER_PASSWORD");

const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error?.code === "email_exists") {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`${email} exists but was not listed`);
  const updated = await admin.auth.admin.updateUserById(user.id, { password });
  if (updated.error) throw updated.error;
  console.log(`Test user ${email} already existed; password reset from .env.`);
} else if (created.error) {
  throw created.error;
} else {
  console.log(`Created test user ${email}.`);
}
