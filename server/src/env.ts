// Process configuration, read only by the entry point, scripts and tests. Kept out of app.ts's
// imports so the web app can type-check against AppType without Node's globals.
import type { AuthConfig } from "./auth.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Set it in .env (npm run setup:local writes a local one; README: Cloud setup).`);
  return value;
}

export function authConfigFromEnv(): AuthConfig {
  return { issuer: `${requireEnv("SUPABASE_URL").replace(/\/$/, "")}/auth/v1` };
}

export function databaseUrlFromEnv(): string {
  return requireEnv("DATABASE_URL");
}
