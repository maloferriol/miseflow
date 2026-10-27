import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertLocalEnv } from "../scripts/local-only.ts";

// Each spec file signs in as its own Cook, so specs that run in parallel never share
// Availability, overrides or Services (#122). Local stack only.
export type TestUser = { id: string; email: string; password: string; token: string };

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const adminClient = (env: NodeJS.ProcessEnv) =>
  createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SECRET_KEY"), options);

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set. Run npm run setup:local to write a local .env.`);
  return value;
}

/** Creates a confirmed user e2e-<specName>-<random>@miseflow.test and signs it in. */
export async function createTestUser(
  specName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TestUser> {
  assertLocalEnv("createTestUser", env);
  const email = `e2e-${specName}-${randomBytes(6).toString("hex")}@miseflow.test`;
  const password = randomBytes(18).toString("base64url");

  const created = await adminClient(env).auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;

  const client = createClient(
    requireEnv(env, "SUPABASE_URL"),
    requireEnv(env, "SUPABASE_PUBLISHABLE_KEY"),
    options,
  );
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { id: created.data.user.id, email, password, token: data.session.access_token };
}

/** Deletes the auth user. The rows it owns stay (no FK to auth.users); specs soft-delete what they track. */
export async function deleteTestUser(user: TestUser) {
  assertLocalEnv("deleteTestUser");
  const { error } = await adminClient(process.env).auth.admin.deleteUser(user.id);
  if (error) throw error;
}
