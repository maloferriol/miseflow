import { describe, expect, it } from "vitest";
import {
  dependenciesNeedInstall,
  nodeVersionProblem,
  parseLsof,
  portProblem,
} from "../../scripts/preflight-checks.ts";

// `npm run preflight` decides pass or fail with these; the script itself only gathers the facts.
describe("preflight", () => {
  it("refuses Node older than 24 and names the fix", () => {
    expect(nodeVersionProblem("v22.18.0")).toMatch(/Node v22\.18\.0 .*24 or later.*nvm install 24/);
  });

  it("accepts Node 24 and later", () => {
    expect(nodeVersionProblem("v24.0.0")).toBeUndefined();
    expect(nodeVersionProblem("v25.5.0")).toBeUndefined();
  });

  it("installs dependencies when node_modules is missing or older than package-lock.json", () => {
    expect(dependenciesNeedInstall({ installedAt: undefined, lockfileAt: 1000 })).toBe(true);
    expect(dependenciesNeedInstall({ installedAt: 999, lockfileAt: 1000 })).toBe(true);
    expect(dependenciesNeedInstall({ installedAt: 1000, lockfileAt: 1000 })).toBe(false);
    expect(dependenciesNeedInstall({ installedAt: 1001, lockfileAt: 1000 })).toBe(false);
  });

  it("reads processes from lsof's field output", () => {
    expect(parseLsof("p636\ncrapportd\nf11\nf12\np714\ncnode\nf10\n")).toEqual([
      { pid: 636, command: "rapportd" },
      { pid: 714, command: "node" },
    ]);
    expect(parseLsof("p41133\nfcwd\nn/Users/cook/miseflow\n")).toEqual([
      { pid: 41133, name: "/Users/cook/miseflow" },
    ]);
  });

  describe("an app port", () => {
    const here = "/Users/cook/miseflow/.claude/worktrees/menus";
    const api = { port: 8787, name: "API" };

    it("passes with no listener, or one started from this checkout", () => {
      expect(portProblem(api, [], here)).toBeUndefined();
      const server = { pid: 51, command: "node", cwd: `${here}/server`, checkout: here };
      expect(portProblem(api, [server], here)).toBeUndefined();
    });

    it("fails when the listener belongs to the checkout this worktree sits inside", () => {
      const main = "/Users/cook/miseflow";
      const listener = { pid: 52, command: "node", cwd: `${main}/server`, checkout: main };

      expect(portProblem(api, [listener], here)).toBe(
        "Port 8787 (API) is held by node (pid 52), started in /Users/cook/miseflow/server, " +
          "which is another checkout. Stop it there, or run `kill 52`.",
      );
    });

    it("fails when the listener is a worktree inside this checkout", () => {
      const listener = { pid: 53, command: "node", cwd: `${here}/web`, checkout: here };

      expect(portProblem({ port: 5173, name: "web" }, [listener], "/Users/cook/miseflow")).toMatch(
        /^Port 5173 \(web\) is held by node \(pid 53\), started in .*worktrees\/menus\/web/,
      );
    });

    it("fails when the listener's directory can't be read", () => {
      const listener = { pid: 54, command: "python3", cwd: undefined, checkout: undefined };

      expect(portProblem(api, [listener], here)).toMatch(
        /held by python3 \(pid 54\), started in an unknown directory/,
      );
    });
  });
});
