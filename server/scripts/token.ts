// Signs in the local test user and prints only the access token, for curl:
//   TOKEN=$(npm run -s token -w server)
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env first.`);
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
