import { execFileSync } from "node:child_process";
import { assertLocalEnv } from "../scripts/local-only.ts";
import { seedFingerprint, sweepTestUsers } from "./test-user.ts";

// Removes what an interrupted run left, seeds the catalog, then records the rows with no owner so
// the teardown can tell whether this run changed them. Local stack only. The sweep takes every
// e2e user, which is safe while the fixed ports allow one e2e run at a time per machine (#156).
export default async function globalSetup() {
  assertLocalEnv("npm run e2e");
  await sweepTestUsers();
  execFileSync("npm", ["run", "seed", "-w", "server"], { stdio: "ignore" });
  process.env.E2E_SEED_FINGERPRINT = JSON.stringify(await seedFingerprint());
}
