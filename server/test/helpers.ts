import { checkoutUser } from "../../scripts/test-user.ts";
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

// The access token of this checkout's test user, signed in once per test file. The user gets a
// new password each time, so files must not run in parallel (fileParallelism is off).
export function getToken(): Promise<string> {
  token ??= checkoutUser().then((user) => user.token);
  return token;
}
