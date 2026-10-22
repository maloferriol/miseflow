import { createClient } from "@supabase/supabase-js";
import { createApp } from "../src/app.ts";
import { authConfigFromEnv } from "../src/auth.ts";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env first.`);
  return value;
}

export const issuer = authConfigFromEnv().issuer;

export function testApp() {
  return createApp({ auth: authConfigFromEnv() });
}

let token: Promise<string> | undefined;

// The local test user's access token, signed in once per test file.
export function getToken(): Promise<string> {
  token ??= (async () => {
    const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_PUBLISHABLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email: requireEnv("TEST_USER_EMAIL"),
      password: requireEnv("TEST_USER_PASSWORD"),
    });
    if (error) throw new Error(`Test user sign-in failed (run npm run setup:local): ${error.message}`);
    return data.session.access_token;
  })();
  return token;
}
