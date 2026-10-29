import { defineConfig } from "vitest/config";
import { coverage } from "../scripts/coverage.ts";
import { loadEnvIntoProcess } from "../scripts/env.ts";

// One env file for the whole run, picked by APP_ENV (ADR 0012).
loadEnvIntoProcess();

export default defineConfig({
  test: {
    // Integration tests share one local database.
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    // src/index.ts is the entry point: it only wires the app and starts it, so no test can run it.
    // Its start-up decision lives in src/prod-gate.ts, which is tested. Sonar excludes it too
    // (sonar.coverage.exclusions in sonar-project.properties), so the two reports agree.
    coverage: { ...coverage, exclude: [...(coverage.exclude ?? []), "src/index.ts"] },
  },
});
