import { expect, test } from "@playwright/test";

// Deliberately red, to show the e2e step can't fail the `check` job (#168). Removed before merge.
test("fails on purpose to prove the e2e step is non-blocking", () => {
  expect(1).toBe(2);
});
