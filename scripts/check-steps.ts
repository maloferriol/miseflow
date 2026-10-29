// The decisions behind `npm run check` (scripts/check.ts): which steps run, in which groups, and
// what the report says. The script runs the commands and times them, so the tests need no machine.
import { nodeMajor } from "./preflight-checks.ts";

/** The opt-in flags. `--sonar` implies `--coverage`, since the analysis reads the lcov files. */
export type CheckOptions = { coverage: boolean; sonar: boolean; e2e: boolean };

export type CheckStep = { name: string; command: string[] };

/**
 * Steps run in order and the group stops at its first failure. The groups of a phase start
 * together, as CI's jobs do, and a phase starts once the one before it is done: 0 installs the
 * dependencies, which every later step needs, 1 is CI's `static` and `test`, 2 the e2e. A group
 * that isn't `blocking` is reported but can't fail the run, like CI's e2e.
 */
export type CheckGroup = { name: string; steps: CheckStep[]; blocking: boolean; phase: number };

/** One row of the report. `ms` is undefined for a step that didn't run. */
export type StepResult = {
  step: string;
  group: string;
  result: "pass" | "fail" | "not run";
  ms: number | undefined;
};

const flags = ["--coverage", "--sonar", "--e2e"];

/** The command-line flags. Throws on one it doesn't take. */
export function parseCheckArgs(args: string[]): CheckOptions {
  const unknown = args.find((arg) => !flags.includes(arg));
  if (unknown)
    throw new Error(
      `Unknown option ${unknown}. \`npm run check\` takes --coverage, --sonar and --e2e.`,
    );
  const sonar = args.includes("--sonar");
  return { coverage: sonar || args.includes("--coverage"), sonar, e2e: args.includes("--e2e") };
}

const npmRun = (script: string): CheckStep => ({ name: script, command: ["npm", "run", script] });

/**
 * What `npm run check` reads from this machine. `repo` is the checkout's root, `gitDir` its git
 * common directory (both absolute), `env` the shell's, and `needsInstall` the preflight's
 * lock-file rule.
 */
export type CheckFacts = {
  repo: string;
  gitDir: string;
  env: NodeJS.ProcessEnv;
  needsInstall: boolean;
};

const sonarCloud = "https://sonarcloud.io";

/**
 * README's local analysis command: the scanner reads sonar-project.properties and the lcov files
 * from the mounted checkout. The token stays in the shell; docker passes it on by name. A
 * worktree's .git file points at the main checkout's git directory, which is mounted at the same
 * path so the scanner has the history CI's full clone gives it.
 */
function sonarStep({ repo, gitDir, env }: CheckFacts): CheckStep {
  const why = '(README "CI and the quality gate")';
  if (!env.SONAR_TOKEN) throw new Error(`--sonar needs SONAR_TOKEN in your shell ${why}.`);
  const host = env.SONAR_HOST_URL || sonarCloud;
  if (host === sonarCloud && !env.SONAR_ORGANIZATION)
    throw new Error(`--sonar needs SONAR_ORGANIZATION in your shell for SonarCloud ${why}.`);

  const command = ["docker", "run", "--rm", "-v", `${repo}:/usr/src`];
  if (!gitDir.startsWith(`${repo}/`)) command.push("-v", `${gitDir}:${gitDir}`);
  command.push(
    "-e",
    "SONAR_TOKEN",
    "-e",
    `SONAR_HOST_URL=${host}`,
    "sonarsource/sonar-scanner-cli",
  );
  if (env.SONAR_ORGANIZATION) command.push(`-Dsonar.organization=${env.SONAR_ORGANIZATION}`);
  return { name: "sonar", command };
}

/**
 * CI's `static` and `test` jobs (.github/workflows/ci.yml), plus what the flags add. Throws when
 * `--sonar` can't run, so it fails before the tests rather than after.
 */
export function checkGroups(options: CheckOptions, facts: CheckFacts): CheckGroup[] {
  const test = [npmRun("setup:local"), npmRun("db:migrate")];
  test.push(npmRun(options.coverage ? "test:coverage" : "test"));
  if (options.sonar) test.push(sonarStep(facts));

  const groups: CheckGroup[] = [];
  if (facts.needsInstall) {
    const install = ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"];
    groups.push({
      name: "install",
      steps: [{ name: "npm ci", command: install }],
      blocking: true,
      phase: 0,
    });
  }
  const staticSteps = ["format:check", "lint", "typecheck", "build"].map(npmRun);
  groups.push({ name: "static", steps: staticSteps, blocking: true, phase: 1 });
  groups.push({ name: "test", steps: test, blocking: true, phase: 1 });
  if (options.e2e) groups.push({ name: "e2e", steps: [npmRun("e2e")], blocking: false, phase: 2 });
  return groups;
}

/** Runs one step and says whether it passed and how long it took. */
export type RunStep = (step: CheckStep, group: CheckGroup) => Promise<{ ok: boolean; ms: number }>;

/** Runs the steps in order. Once one fails, or when `skip` is set, the rest are "not run". */
async function runGroup(group: CheckGroup, runStep: RunStep, skip: boolean): Promise<StepResult[]> {
  const results: StepResult[] = [];
  let failed = skip;
  for (const step of group.steps) {
    const row = { step: step.name, group: group.name };
    if (failed) {
      results.push({ ...row, result: "not run", ms: undefined });
      continue;
    }
    const { ok, ms } = await runStep(step, group);
    results.push({ ...row, result: ok ? "pass" : "fail", ms });
    failed = !ok;
  }
  return results;
}

/**
 * Runs the groups phase by phase. A failed install stops every later phase; any other failure
 * leaves the next phase to run, as CI's e2e runs whatever the other jobs did. Returns every
 * step's row, in the order of `groups`.
 */
export async function runChecks(groups: CheckGroup[], runStep: RunStep): Promise<StepResult[]> {
  const byGroup = new Map<CheckGroup, StepResult[]>();
  let blocked = false;
  for (const phase of [...new Set(groups.map((group) => group.phase))].sort((a, b) => a - b)) {
    const inPhase = groups.filter((group) => group.phase === phase);
    const results = await Promise.all(inPhase.map((group) => runGroup(group, runStep, blocked)));
    inPhase.forEach((group, i) => byGroup.set(group, results[i]!));
    blocked ||= phase === 0 && results.some((rows) => rows.some((row) => row.result !== "pass"));
  }
  return groups.flatMap((group) => byGroup.get(group)!);
}

/** Whether CI's `check` job would pass: every step of every blocking group passed. */
export function checkPassed(groups: CheckGroup[], results: StepResult[]): boolean {
  const blocking = new Set(groups.filter((group) => group.blocking).map((group) => group.name));
  return results.every((row) => !blocking.has(row.group) || row.result === "pass");
}

/** 2.1s under a minute, 1m 05s from there. */
function duration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

const marks = { pass: "✓", fail: "✗", "not run": "–" };

/** The table of every step, then the total wall time and whether CI's check would pass. */
export function formatReport(groups: CheckGroup[], results: StepResult[], wallMs: number): string {
  const rows = [
    ["Step", "Group", "Result", "Time"],
    ...results.map((row) => [
      row.step,
      row.group,
      `${marks[row.result]} ${row.result}`,
      row.ms === undefined ? "" : duration(row.ms),
    ]),
  ];
  const width = (column: number) => Math.max(...rows.map((row) => row[column]!.length));
  const lines = rows.map(([step, group, result, time]) =>
    [
      step!.padEnd(width(0)),
      group!.padEnd(width(1)),
      result!.padEnd(width(2)),
      time!.padStart(width(3)),
    ]
      .join("  ")
      .trimEnd(),
  );

  const passed = checkPassed(groups, results);
  let verdict = `Total ${duration(wallMs)}. ${passed ? "✓ CI's check would pass." : "✗ CI's check would fail."}`;
  for (const group of groups.filter((group) => !group.blocking)) {
    if (results.some((row) => row.group === group.name && row.result === "fail"))
      verdict += ` The ${group.name} failed${passed ? "" : " too"} (non-blocking, as in CI).`;
  }
  return [...lines, "", verdict].join("\n");
}

/** CI runs Node 24 (.github/actions/install). */
const ciNodeMajor = 24;

/** A warning when `version` (as in `process.version`) isn't CI's major, or undefined. */
export function nodeMajorWarning(version: string): string | undefined {
  if (nodeMajor(version) === ciNodeMajor) return undefined;
  return `Node ${version} isn't ${ciNodeMajor}, the version CI runs, so a result here may differ from CI's.`;
}
