import { createClient } from "@supabase/supabase-js";
import { type AppOptions, createApp } from "../src/app.ts";
import { createDb } from "../src/db.ts";
import { authConfigFromEnv, databaseUrlFromEnv } from "../src/env.ts";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run npm run setup:local to write .env.test.`);
  return value;
}

export const issuer = authConfigFromEnv().issuer;

export const db = createDb(databaseUrlFromEnv());

// A fixed clock (a Monday before the walkthrough), so no test reads the wall clock (#88).
export const FIXED_NOW = new Date("2026-10-26T12:00:00Z");

export function testApp(options: Partial<AppOptions> = {}) {
  return createApp({
    auth: authConfigFromEnv(),
    db,
    timeZone: "Europe/Paris",
    now: () => FIXED_NOW,
    ...options,
  });
}

let token: Promise<string> | undefined;

// The local test user's access token, signed in once per test file.
export function getToken(): Promise<string> {
  token ??= (async () => {
    const client = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_PUBLISHABLE_KEY"),
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data, error } = await client.auth.signInWithPassword({
      email: requireEnv("TEST_USER_EMAIL"),
      password: requireEnv("TEST_USER_PASSWORD"),
    });
    if (error)
      throw new Error(`Test user sign-in failed (run npm run setup:local): ${error.message}`);
    return data.session.access_token;
  })();
  return token;
}
