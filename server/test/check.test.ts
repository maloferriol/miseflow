import { describe, expect, it } from "vitest";
import {
  checkGroups,
  checkPassed,
  formatReport,
  nodeMajorWarning,
  parseCheckArgs,
  runChecks,
  type CheckGroup,
  type StepResult,
} from "../../scripts/check-steps.ts";

const facts = { needsInstall: false };
const stepNames = (groups: CheckGroup[]) =>
  groups.map((group) => ({ group: group.name, steps: group.steps.map((step) => step.name) }));
const named = (groups: CheckGroup[], name: string) => groups.find((group) => group.name === name)!;

// `npm run check` decides what to run and how to report it with these; scripts/check.ts only runs
// the commands.
describe("npm run check", () => {
  describe("the steps", () => {
    it("runs CI's static and test groups, with npm test instead of coverage", () => {
      expect(stepNames(checkGroups(parseCheckArgs([]), facts))).toEqual([
        { group: "static", steps: ["format:check", "lint", "typecheck", "build"] },
        { group: "test", steps: ["setup:local", "db:migrate", "test"] },
      ]);
    });

    it("runs the tests with coverage on --coverage", () => {
      const test = named(checkGroups(parseCheckArgs(["--coverage"]), facts), "test");

      expect(test.steps.map((step) => step.command)).toEqual([
        ["npm", "run", "setup:local"],
        ["npm", "run", "db:migrate"],
        ["npm", "run", "test:coverage"],
      ]);
    });

    it("adds a non-blocking e2e group that runs after the others on --e2e", () => {
      const groups = checkGroups(parseCheckArgs(["--e2e"]), facts);

      expect(named(groups, "e2e")).toMatchObject({ blocking: false, phase: 2 });
      expect(named(groups, "e2e").steps.map((step) => step.command)).toEqual([
        ["npm", "run", "e2e"],
      ]);
      expect(groups.filter((group) => group.phase === 1).map((group) => group.name)).toEqual([
        "static",
        "test",
      ]);
    });

    it("installs dependencies first, the way CI does, only when they're out of date", () => {
      const groups = checkGroups(parseCheckArgs([]), { ...facts, needsInstall: true });

      expect(groups[0]).toEqual({
        name: "install",
        steps: [
          { name: "npm ci", command: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"] },
        ],
        blocking: true,
        phase: 0,
      });
      expect(groups.slice(1).map((group) => group.name)).toEqual(["static", "test"]);
    });

    it("refuses an unknown flag and names the ones it takes", () => {
      expect(() => parseCheckArgs(["--sonar"])).toThrow(
        "Unknown option --sonar. `npm run check` takes --coverage and --e2e.",
      );
    });
  });

  describe("running the groups", () => {
    const group = (name: string, steps: string[], phase = 1, blocking = true): CheckGroup => ({
      name,
      steps: steps.map((step) => ({ name: step, command: ["npm", "run", step] })),
      blocking,
      phase,
    });
    const groups = [
      group("static", ["format:check", "lint", "typecheck"]),
      group("test", ["setup:local", "test"]),
      group("e2e", ["e2e"], 2, false),
    ];

    /** Runs `groups` with steps that fail when named in `failing`, and logs when each starts and ends. */
    async function run(groups: CheckGroup[], failing: string[] = []) {
      const log: string[] = [];
      const results = await runChecks(groups, async (step) => {
        log.push(`start ${step.name}`);
        await new Promise((resolve) => setTimeout(resolve, 1));
        log.push(`end ${step.name}`);
        return { ok: !failing.includes(step.name), ms: 10 };
      });
      return { log, results };
    }

    const row = (step: string, group: string, result: StepResult["result"]) =>
      expect.objectContaining({ step, group, result });

    it("starts a phase's groups together and runs each group's steps in order", async () => {
      const { log, results } = await run(groups);

      expect(log.slice(0, 2)).toEqual(["start format:check", "start setup:local"]);
      expect(log.indexOf("start lint")).toBeGreaterThan(log.indexOf("end format:check"));
      expect(log.indexOf("start e2e")).toBe(log.indexOf("end typecheck") + 1);
      expect(results).toEqual([
        { step: "format:check", group: "static", result: "pass", ms: 10 },
        { step: "lint", group: "static", result: "pass", ms: 10 },
        { step: "typecheck", group: "static", result: "pass", ms: 10 },
        { step: "setup:local", group: "test", result: "pass", ms: 10 },
        { step: "test", group: "test", result: "pass", ms: 10 },
        { step: "e2e", group: "e2e", result: "pass", ms: 10 },
      ]);
    });

    it("stops a group at its first failure and lets the other group finish", async () => {
      const { results } = await run(groups.slice(0, 2), ["lint"]);

      expect(results).toEqual([
        row("format:check", "static", "pass"),
        row("lint", "static", "fail"),
        { step: "typecheck", group: "static", result: "not run", ms: undefined },
        row("setup:local", "test", "pass"),
        row("test", "test", "pass"),
      ]);
    });

    it("still runs the e2e after a failed static or test group, as CI does", async () => {
      const { results } = await run(groups, ["lint"]);

      expect(results.at(-1)).toEqual(row("e2e", "e2e", "pass"));
    });

    it("runs nothing more once the install failed", async () => {
      const install = group("install", ["npm ci"], 0);

      expect((await run([install, ...groups], ["npm ci"])).results).toEqual([
        row("npm ci", "install", "fail"),
        row("format:check", "static", "not run"),
        row("lint", "static", "not run"),
        row("typecheck", "static", "not run"),
        row("setup:local", "test", "not run"),
        row("test", "test", "not run"),
        row("e2e", "e2e", "not run"),
      ]);
    });
  });

  describe("the verdict and report", () => {
    const blockingGroups = checkGroups(parseCheckArgs(["--e2e"]), facts);
    const pass = (step: string, group: string, ms: number): StepResult => ({
      step,
      group,
      result: "pass",
      ms,
    });

    it("passes when every blocking step passed, whatever the e2e did", () => {
      const rows = [pass("lint", "static", 1), pass("test", "test", 1)];
      const e2e = (result: StepResult["result"]): StepResult => ({
        step: "e2e",
        group: "e2e",
        result,
        ms: 1,
      });

      expect(checkPassed(blockingGroups, [...rows, e2e("fail")])).toBe(true);
      expect(
        checkPassed(blockingGroups, [{ ...rows[0], result: "fail" }, rows[1], e2e("pass")]),
      ).toBe(false);
      expect(
        checkPassed(blockingGroups, [rows[0], { ...rows[1], result: "not run", ms: undefined }]),
      ).toBe(false);
    });

    it("prints a table of step, group, result and duration, then the wall time", () => {
      const rows: StepResult[] = [
        pass("format:check", "static", 2_140),
        { step: "lint", group: "static", result: "fail", ms: 31_870 },
        { step: "typecheck", group: "static", result: "not run", ms: undefined },
        pass("test:coverage", "test", 95_400),
        { step: "e2e", group: "e2e", result: "fail", ms: 61_000 },
      ];

      expect(formatReport(blockingGroups, rows, 158_250)).toBe(
        [
          "Step           Group   Result       Time",
          "format:check   static  ✓ pass       2.1s",
          "lint           static  ✗ fail      31.9s",
          "typecheck      static  – not run",
          "test:coverage  test    ✓ pass     1m 35s",
          "e2e            e2e     ✗ fail     1m 01s",
          "",
          "Total 2m 38s. ✗ CI's check would fail. The e2e failed too (non-blocking, as in CI).",
        ].join("\n"),
      );
    });

    it("says CI would pass when it would", () => {
      const rows = [pass("lint", "static", 400), pass("test", "test", 1_000)];

      expect(formatReport(blockingGroups, rows, 1_000).split("\n").at(-1)).toBe(
        "Total 1.0s. ✓ CI's check would pass.",
      );
    });

    it("warns when the Node major isn't the 24 CI pins", () => {
      expect(nodeMajorWarning("v24.11.0")).toBeUndefined();
      expect(nodeMajorWarning("v25.1.0")).toBe(
        "Node v25.1.0 isn't 24, the version CI runs, so a result here may differ from CI's.",
      );
    });
  });
});
