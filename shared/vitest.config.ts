import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { coverage } from "../scripts/coverage.ts";

// Local development keeps its values in the repo root's git-ignored .env.
const rootEnv = new URL("../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    coverage,
  },
});
