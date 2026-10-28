import { defineConfig } from "vitest/config";
import { coverage } from "../scripts/coverage.ts";

// Two projects (ADR 0011): the pure logic's `*.test.ts` run in Node, and the view, hook and wired
// tests' `*.test.tsx` run under jsdom with Testing Library. The Playwright e2e is the only test in a real browser.
// Source: https://vitest.dev/guide/projects
export default defineConfig({
  test: {
    coverage,
    projects: [
      {
        extends: true,
        test: { name: "logic", include: ["src/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: { name: "view", include: ["src/**/*.test.tsx"], environment: "jsdom" },
      },
    ],
  },
});
