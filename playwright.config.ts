import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { assertLocalEnv } from "./scripts/local-only.ts";

// Local development keeps its values in the repo root's git-ignored .env.
if (existsSync(".env")) process.loadEnvFile(".env");
// Refuse a cloud .env before either server starts.
assertLocalEnv("npm run e2e");

// Runs against the local Supabase stack (`npx supabase start`, `npm run setup:local`,
// `npm run db:migrate`). Always starts its own API and web app, so it tests this checkout's code:
// a server already on 8787 or 5173 fails the run, even this checkout's own dev server.
// Source: https://playwright.dev/docs/test-webserver
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { baseURL: "http://localhost:5173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run start -w server",
      url: "http://localhost:8787/health",
      // The e2e's Plan days are Paris dates, whatever the machine's zone.
      env: { KITCHEN_TIME_ZONE: "Europe/Paris" },
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -w web -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: false,
    },
  ],
});
