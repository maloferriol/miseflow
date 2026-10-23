// Prepares the local Supabase stack: an ES256 signing key that Hono's jwk() can verify,
// the stack itself, and the single test user (sign-ups are off, ADR 0008).
// Run from the repo root with `npm run setup:local`. Local development only.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const keysFile = fileURLToPath(new URL("../../supabase/signing_keys.json", import.meta.url));

function supabase(...args: string[]) {
  execFileSync("npx", ["supabase", ...args], { cwd: repoRoot, stdio: "inherit" });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env first.`);
  return value;
}

// 1. Signing key. The CLI only appends to an existing file, so start from an empty key set.
if (!existsSync(keysFile)) {
  writeFileSync(keysFile, "[]\n", { mode: 0o600 });
  supabase("gen", "signing-key", "--algorithm", "ES256", "--append");
}

// 2. The stack. A no-op when it is already running.
supabase("start");

// 3. The test user, created confirmed. Re-running resets the password to the one in .env.
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
