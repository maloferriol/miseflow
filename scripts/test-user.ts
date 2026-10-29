// Test users on the local Supabase stack, shared by e2e, the server tests, `npm run token` and
// `npm run dev:user` (ADR 0012). Two kinds:
//  - a per-spec user (createTestUser), made fresh for each e2e spec file (#122);
//  - the checkout's own user (checkoutUser), one fixed email per checkout, created if missing and
//    given a fresh random password on every call. Nothing stores the password.
// Local stack only.
import { createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { repoRoot } from "./env.ts";
import { assertLocalEnv } from "./local-only.ts";

export type TestUser = { id: string; email: string; password: string; token: string };

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const adminClient = (env: NodeJS.ProcessEnv) =>
  createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SECRET_KEY"), options);

export function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set. Run npm run setup:local to write .env.test.`);
  return value;
}

async function signIn(env: NodeJS.ProcessEnv, email: string, password: string) {
  const client = createClient(
    requireEnv(env, "SUPABASE_URL"),
    requireEnv(env, "SUPABASE_PUBLISHABLE_KEY"),
    options,
  );
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

const freshPassword = () => randomBytes(18).toString("base64url");

/**
 * Creates a confirmed user e2e-<specName>-<random>-<runPid>@miseflow.test and signs it in. The
 * runner's pid tells another worktree's run that this run is still going (#156).
 */
export async function createTestUser(
  specName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TestUser> {
  assertLocalEnv("createTestUser", env);
  const email = testUserEmail(specName, runPid(env));
  const password = freshPassword();

  const created = await adminClient(env).auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  return { id: created.data.user.id, email, password, token: await signIn(env, email, password) };
}

/** The name of the checkout holding this code: its directory name. */
export const checkoutName = () => basename(repoRoot.replace(/\/$/, ""));

/**
 * The checkout's fixed email, checkout-<name>-<hash>@miseflow.test. The name is lower-cased and
 * cut to letters, digits and dashes; the hash of the exact name keeps `a_b` and `a-b` apart.
 */
export function checkoutEmail(name: string = checkoutName()): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "checkout";
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 6);
  return `checkout-${slug}-${hash}@miseflow.test`;
}

/**
 * The checkout's own user, created confirmed if missing, with a new random password on every
 * call, signed in. The password lives in the returned value only. Calling it again invalidates
 * the previous password, so call it once per process and keep the result.
 */
export async function checkoutUser(
  name: string = checkoutName(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<TestUser> {
  assertLocalEnv("checkoutUser", env);
  const admin = adminClient(env);
  const email = checkoutEmail(name);
  const password = freshPassword();

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  let id = created.data.user?.id;
  if (created.error?.code === "email_exists") {
    id = await findUserId(admin, email);
    const updated = await admin.auth.admin.updateUserById(id, { password });
    if (updated.error) throw updated.error;
  } else if (created.error) {
    throw created.error;
  }
  return { id: id!, email, password, token: await signIn(env, email, password) };
}

async function findUserId(admin: ReturnType<typeof adminClient>, email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((u) => u.email === email);
    if (user) return user.id;
    if (data.users.length < 200) throw new Error(`${email} exists but was not listed`);
  }
}

/** The pid of the Playwright runner this run belongs to, which the config writes to the env. */
export function runPid(env: NodeJS.ProcessEnv) {
  return Number(requireEnv(env, "E2E_RUN_PID"));
}

const testUserEmail = (specName: string, pid: number) =>
  `e2e-${specName}-${randomBytes(6).toString("hex")}-${pid}@miseflow.test`;
