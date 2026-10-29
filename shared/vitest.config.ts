import { defineConfig } from "vitest/config";
import { coverage } from "../scripts/coverage.ts";
import { loadEnvIntoProcess } from "../scripts/env.ts";

// One env file for the whole run, picked by APP_ENV (ADR 0012).
loadEnvIntoProcess();

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    coverage,
  },
});
