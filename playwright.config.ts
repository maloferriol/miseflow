import { defineConfig, devices } from "@playwright/test";
import { loadEnvIntoProcess } from "./scripts/env.ts";
import { pickE2ePorts } from "./scripts/e2e-ports.ts";
import { assertLocalEnv } from "./scripts/local-only.ts";

// One env file for the whole run, picked by APP_ENV (ADR 0012).
loadEnvIntoProcess();
// Refuse prod values before either server starts.
assertLocalEnv("npm run e2e");
// The runner loads this config first, picks free ports and marks this run's e2e users with its
// pid, so another worktree's run leaves them alone. The workers, which inherit its env, read both
// back: Playwright forks them with `env: { ...process.env }` (ProcessHost.startRunner in
// node_modules/playwright/lib/runner/index.js, 1.64). Ports from the env file or the shell never count.
if (!process.env.E2E_RUN_PID) {
  process.env.E2E_RUN_PID = `${process.pid}`;
  delete process.env.E2E_API_PORT;
  delete process.env.E2E_WEB_PORT;
}
const ports = await pickE2ePorts();

// Runs against the local Supabase stack (`npx supabase start`, `npm run setup:local`,
// `npm run db:migrate`). Always starts its own API and web app, on ports no other server uses, so
// it tests this checkout's code while dev servers or another worktree's e2e run alongside (#156).
// Source: https://playwright.dev/docs/test-webserver
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // In CI a test that passes only on retry is reported as flaky. Local runs keep no retries.
  retries: process.env.CI ? 1 : 0,
  // CI writes the HTML and JSON reports for the workflow to upload, and annotates failures.
  // Local runs keep the default reporter.
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["json", { outputFile: "playwright-report/results.json" }],
      ]
    : undefined,
  use: { baseURL: `http://localhost:${ports.web}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run start -w server",
      url: `http://localhost:${ports.api}/health`,
      // The e2e's Plan days are Paris dates, whatever the machine's zone.
      env: { PORT: `${ports.api}`, KITCHEN_TIME_ZONE: "Europe/Paris" },
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -w web -- --port ${ports.web} --strictPort`,
      url: `http://localhost:${ports.web}`,
      // The dev proxy sends /api to this run's API.
      env: { API_PORT: `${ports.api}` },
      reuseExistingServer: false,
    },
  ],
});
