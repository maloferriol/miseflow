import type { CoverageOptions } from "vitest/node";

// Every workspace's `npm run test:coverage` writes <workspace>/coverage/lcov.info. Its paths are
// relative to the repo root, so SonarQube (sonar-project.properties) finds the files from there.
// Source: https://vitest.dev/config/#coverage
export const coverage: CoverageOptions = {
  provider: "v8",
  include: ["src/**"],
  // The web's entry point only mounts App, so no test can run it. Sonar excludes it too
  // (sonar.coverage.exclusions in sonar-project.properties), so the two reports agree.
  exclude: ["src/main.tsx"],
  reporter: ["text-summary", ["lcov", { projectRoot: ".." }]],
};
