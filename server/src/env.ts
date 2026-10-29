// Process configuration, read only by the entry point, scripts and tests. Kept out of app.ts's
// imports so the web app can type-check against AppType without Node's globals.
import type { AuthConfig } from "./auth.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} is not set. Set it in .env.test or .env.prod (npm run setup:local writes .env.test; README: Prod setup).`,
    );
  return value;
}

export function authConfigFromEnv(): AuthConfig {
  return { issuer: `${requireEnv("SUPABASE_URL").replace(/\/$/, "")}/auth/v1` };
}

/**
 * The kitchen's IANA time zone from KITCHEN_TIME_ZONE (D2), else the server process's zone with a
 * warning. An unknown zone throws: Intl.DateTimeFormat throws RangeError for it. Source:
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#exceptions
 */
export function kitchenTimeZoneFromEnv(): string {
  const value = process.env.KITCHEN_TIME_ZONE;
  if (!value) {
    const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.warn(`KITCHEN_TIME_ZONE is not set; using the server's time zone, ${fallback}.`);
    return fallback;
  }
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`KITCHEN_TIME_ZONE is not a known IANA time zone: ${value}`);
  }
}

export function databaseUrlFromEnv(): string {
  return requireEnv("DATABASE_URL");
}
