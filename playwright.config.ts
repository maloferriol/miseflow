import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local development keeps its values in the repo root's git-ignored .env.
if (existsSync(".env")) process.loadEnvFile(".env");

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
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev -w web -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
