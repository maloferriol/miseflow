import { assertLocalEnv } from "../scripts/local-only.ts";
import { seedFingerprint, testUserLeftovers } from "./test-user.ts";

// Fails the run when an e2e user or its rows outlived it, or when the rows with no owner changed.
export default async function globalTeardown() {
  assertLocalEnv("npm run e2e");
  const problems: string[] = [];

  const { users, rows } = await testUserLeftovers();
  if (users > 0 || Object.keys(rows).length > 0)
    problems.push(
      `${users} e2e users and their rows are left: ${JSON.stringify(rows)}. ` +
        "Call deleteTestUser in the spec's afterAll.",
    );

  const before: Record<string, string> = JSON.parse(process.env.E2E_SEED_FINGERPRINT ?? "{}");
  const after = await seedFingerprint();
  const changed = Object.keys(after).filter((table) => after[table] !== before[table]);
  if (changed.length > 0)
    problems.push(
      `This run added, changed or removed rows with no owner in ${changed.join(", ")}. ` +
        "Every row an e2e spec writes needs its test user as owner.",
    );

  if (problems.length > 0) throw new Error(problems.join("\n"));
}
