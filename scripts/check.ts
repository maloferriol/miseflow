// `npm run check`: runs the checks CI's required `check` job depends on, on this machine, and says
// whether CI would pass. Fast by default: it skips `npm ci` when node_modules is up to date, reuses
// the running local stack, and runs `npm test` (`--coverage` for `test:coverage`). `--e2e` adds the
// e2e, which is reported but, as in CI, can't fail the run. The SonarQube gate runs only in CI.
// The decisions live in check-steps.ts, which has the tests.
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkGroups,
  checkPassed,
  formatReport,
  nodeMajorWarning,
  parseCheckArgs,
  runChecks,
  type CheckGroup,
  type RunStep,
} from "./check-steps.ts";
import { dependenciesNeedInstall } from "./preflight-checks.ts";

const repoDir = fileURLToPath(new URL("..", import.meta.url));

let groups: CheckGroup[];
try {
  const installedAt = statSync(`${repoDir}node_modules/.package-lock.json`, {
    throwIfNoEntry: false,
  })?.mtimeMs;
  const lockfileAt = statSync(`${repoDir}package-lock.json`).mtimeMs;
  groups = checkGroups(parseCheckArgs(process.argv.slice(2)), {
    needsInstall: dependenciesNeedInstall({ installedAt, lockfileAt }),
  });
} catch (error) {
  console.error(`✗ ${(error as Error).message}`);
  process.exit(1);
}

const nodeWarning = nodeMajorWarning(process.version);
if (nodeWarning) console.warn(`! ${nodeWarning}`);

/**
 * The groups run side by side, so each step's output is kept and printed only when it fails.
 * A line marks each step as it ends.
 */
const runStep: RunStep = (step, group) =>
  new Promise((resolve) => {
    const started = performance.now();
    const [command, ...args] = step.command;
    const child = spawn(command!, args, { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    // A command that can't start emits `error`, and may emit `close` after it.
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      const ms = performance.now() - started;
      console.log(`${ok ? "✓" : "✗"} ${step.name} (${group.name})`);
      if (!ok) console.log(`\n── ${step.name} output ──\n${output.trimEnd()}\n`);
      resolve({ ok, ms });
    };
    child.on("error", (error) => {
      output += error.message;
      finish(false);
    });
    child.on("close", (code) => finish(code === 0));
  });

console.log(`Running ${groups.map((group) => group.name).join(", ")}…`);
const started = performance.now();
const results = await runChecks(groups, runStep);
console.log(`\n${formatReport(groups, results, performance.now() - started)}`);
// Again under the table, where it can't scroll away.
if (nodeWarning) console.warn(`! ${nodeWarning}`);
process.exit(checkPassed(groups, results) ? 0 : 1);
