// Signs in the local test user and prints only the access token, for curl:
//   TOKEN=$(npm run -s token -w server)
import "../../scripts/load-env.ts";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run npm run setup:local to write .env.test.`);
  return value;
}

const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_PUBLISHABLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await client.auth.signInWithPassword({
  email: requireEnv("TEST_USER_EMAIL"),
  password: requireEnv("TEST_USER_PASSWORD"),
});
if (error) throw error;
process.stdout.write(data.session.access_token + "\n");
