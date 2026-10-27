import type { CoverageOptions } from "vitest/node";

// Every workspace's `npm run test:coverage` writes <workspace>/coverage/lcov.info. Its paths are
// relative to the repo root, so SonarQube (sonar-project.properties) finds the files from there.
// Source: https://vitest.dev/config/#coverage
export const coverage: CoverageOptions = {
  provider: "v8",
  include: ["src/**"],
  reporter: ["text-summary", ["lcov", { projectRoot: ".." }]],
};
