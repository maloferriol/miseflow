import { defineConfig } from "vitest/config";
import { coverage } from "../scripts/coverage.ts";

// Unit tests for the web's pure logic only; the Playwright e2e covers rendering.
export default defineConfig({
  test: { coverage },
});
