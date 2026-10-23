import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { assertLocalEnv } from "./scripts/local-only.ts";

// Local development keeps its values in the repo root's git-ignored .env.
if (existsSync(".env")) process.loadEnvFile(".env");
// The servers below are reused when they already run, so refuse a cloud .env before either starts.
assertLocalEnv("npm run e2e");

// Runs against the local Supabase stack (`npx supabase start`, `npm run setup:local`,
// `npm run db:migrate`). Starts the API and the web app unless they already run.
// Source: https://playwright.dev/docs/test-webserver
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:5173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run start -w server",
      url: "http://localhost:8787/health",
      // The e2e's Plan days are Paris dates, whatever the machine's zone.
      env: { KITCHEN_TIME_ZONE: "Europe/Paris" },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev -w web -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
