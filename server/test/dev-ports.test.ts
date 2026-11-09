import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimPortsFile } from "../../scripts/checkout-ports.ts";
import {
  devPortsTable,
  listeningPorts,
  mainCheckoutPorts,
  pickPortBlock,
  readDevPortsFile,
  resolveDevPorts,
  worktreePaths,
} from "../../scripts/dev-ports-plan.ts";

// Each checkout's dev-server ports (#157). The scripts only gather facts; these decide.
describe("dev ports", () => {
  const worktree = {
    test: { api: 20004, web: 20005 },
    prod: { api: 20006, web: 20007 },
  };

  describe("resolving a checkout's ports", () => {
    it("gives the main checkout 8787/5173 for test and 8788/5174 for prod", () => {
      const main = () => mainCheckoutPorts;
      expect(resolveDevPorts({}, main)).toEqual({ api: 8787, web: 5173 });
      expect(resolveDevPorts({ APP_ENV: "test" }, main)).toEqual({ api: 8787, web: 5173 });
      expect(resolveDevPorts({ APP_ENV: "prod" }, main)).toEqual({ api: 8788, web: 5174 });
    });

    it("reads a worktree's ports for the running APP_ENV", () => {
      expect(resolveDevPorts({}, () => worktree)).toEqual({ api: 20004, web: 20005 });
      expect(resolveDevPorts({ APP_ENV: "prod" }, () => worktree)).toEqual({
        api: 20006,
        web: 20007,
      });
    });

    it("lets API_PORT and WEB_PORT override, without asking for the checkout's ports", () => {
      const never = () => {
        throw new Error("the checkout's ports were asked for");
      };
      const env = { API_PORT: "41001", WEB_PORT: "41002" };
      expect(resolveDevPorts(env, never)).toEqual({ api: 41001, web: 41002 });
      expect(resolveDevPorts({ ...env, APP_ENV: "prod" }, never)).toEqual({
        api: 41001,
        web: 41002,
      });
    });

    it("overrides one port and takes the other from the checkout", () => {
      expect(resolveDevPorts({ API_PORT: "41001" }, () => worktree)).toEqual({
        api: 41001,
        web: 20005,
      });
      expect(resolveDevPorts({ WEB_PORT: "41002", APP_ENV: "prod" }, () => worktree)).toEqual({
        api: 20006,
        web: 41002,
      });
    });

    it("refuses a port that isn't a number", () => {
      expect(() =>
        resolveDevPorts({ API_PORT: "eighty", WEB_PORT: "5173" }, () => worktree),
      ).toThrow('API_PORT is "eighty", but it must be a port number (1 to 65535).');
    });

    it("refuses an unknown APP_ENV", () => {
      expect(() => resolveDevPorts({ APP_ENV: "staging" }, () => worktree)).toThrow(/APP_ENV/);
    });
  });
  describe("a .dev-ports.json", () => {
    const here = "/Users/cook/miseflow/.claude/worktrees/menus";
    const file = `${here}/.dev-ports.json`;
    const text = JSON.stringify({ checkout: here, ...worktree });

    it("gives this checkout's ports", () => {
      expect(readDevPortsFile(text, file, here)).toEqual(worktree);
    });

    it("counts as missing when it names another checkout, as a copied file does", () => {
      expect(
        readDevPortsFile(text, file, "/Users/cook/miseflow/.claude/worktrees/plan"),
      ).toBeUndefined();
    });

    it("refuses a file it can't read, naming it and saying to delete it", () => {
      const unreadable = [
        "{ not json",
        "[]",
        JSON.stringify({ checkout: here, test: worktree.test }),
        JSON.stringify({ checkout: here, ...worktree, prod: { api: "20006", web: 20007 } }),
        JSON.stringify({ checkout: here, ...worktree, test: { api: 20004, web: 70000 } }),
        JSON.stringify({ ...worktree }),
      ];
      for (const bad of unreadable)
        expect(() => readDevPortsFile(bad, file, here), bad).toThrow(
          `${file} can't be read as this checkout's dev ports. Delete it, and the next dev ` +
            "command picks new ports.",
        );
    });
  });
  describe("picking a worktree's ports", () => {
    it("takes the first block of 4 from 20000: test API, test web, prod API, prod web", () => {
      expect(pickPortBlock([], [])).toEqual({
        test: { api: 20000, web: 20001 },
        prod: { api: 20002, web: 20003 },
      });
    });

    it("skips a block another worktree's file claims any port of", () => {
      expect(pickPortBlock([20000, 20001, 20002, 20003, 20006], [])).toEqual({
        test: { api: 20008, web: 20009 },
        prod: { api: 20010, web: 20011 },
      });
    });

    it("skips a block with a port something listens on", () => {
      expect(pickPortBlock([], [20003])).toEqual(worktree);
      expect(pickPortBlock([20000], [20004, 8787])).toEqual({
        test: { api: 20008, web: 20009 },
        prod: { api: 20010, web: 20011 },
      });
    });

    it("refuses when no block between 20000 and 29999 is free", () => {
      const all = Array.from({ length: 10_000 }, (_, i) => 20_000 + i);
      const evens = all.filter((port) => port % 2 === 0);
      const odds = all.filter((port) => port % 2 === 1);
      expect(() => pickPortBlock(evens, odds)).toThrow(
        "No block of 4 free ports is left between 20000 and 29999: other worktrees' " +
          ".dev-ports.json files claim them or something listens on them. Remove worktrees " +
          "you no longer use (`git worktree remove`), then try again.",
      );
    });
  });
  it("reads every checkout's path from git worktree list, the main checkout first", () => {
    const porcelain =
      "worktree /Users/cook/miseflow\nHEAD 241fd01\nbranch refs/heads/main\n\n" +
      "worktree /Users/cook/miseflow/.claude/worktrees/menus\nHEAD d67bff2\ndetached\n\n";
    expect(worktreePaths(porcelain)).toEqual([
      "/Users/cook/miseflow",
      "/Users/cook/miseflow/.claude/worktrees/menus",
    ]);
  });

  it("reads the listening ports from lsof's field output, IPv4 and IPv6", () => {
    const lsof = "p636\nf11\nn*:20000\nf12\nn127.0.0.1:20001\np714\nf10\nn[::1]:20002\n";
    expect(listeningPorts(lsof)).toEqual([20000, 20001, 20002]);
  });
  it("lists every checkout's URLs for npm run dev:ports, marking this one", () => {
    const table = devPortsTable([
      { path: "/Users/cook/miseflow", ports: mainCheckoutPorts, current: false },
      { path: "/Users/cook/miseflow/.claude/worktrees/menus", ports: worktree, current: true },
      { path: "/Users/cook/miseflow/.claude/worktrees/plan", ports: undefined, current: false },
    ]);
    expect(table.split("\n")).toEqual([
      "  Checkout                                     Test API                Test web                Prod API                Prod web",
      "  /Users/cook/miseflow                         http://localhost:8787   http://localhost:5173   http://localhost:8788   http://localhost:5174",
      "* /Users/cook/miseflow/.claude/worktrees/menus http://localhost:20004  http://localhost:20005  http://localhost:20006  http://localhost:20007",
      "  /Users/cook/miseflow/.claude/worktrees/plan  not assigned",
      "",
      "* this checkout",
    ]);
  });
  describe("claiming a worktree's .dev-ports.json", () => {
    let dir: string;
    let file: string;
    const winner = { test: { api: 20008, web: 20009 }, prod: { api: 20010, web: 20011 } };
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "dev-ports-"));
      file = join(dir, ".dev-ports.json");
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    const onDisk = () => JSON.parse(readFileSync(file, "utf8"));

    it("creates it with newly picked ports when there's none", () => {
      expect(claimPortsFile(file, dir, () => worktree)).toEqual(worktree);
      expect(onDisk()).toEqual({ checkout: dir, ...worktree });
      expect(readdirSync(dir)).toEqual([".dev-ports.json"]);
    });

    it("keeps the ports already in it, picking none", () => {
      writeFileSync(file, JSON.stringify({ checkout: dir, ...winner }));
      const pick = () => {
        throw new Error("picked new ports");
      };
      expect(claimPortsFile(file, dir, pick)).toEqual(winner);
    });

    it("uses the other server's file when it lost the race to create it", () => {
      const pickWhileTheOtherWins = () => {
        writeFileSync(file, JSON.stringify({ checkout: dir, ...winner }));
        return worktree;
      };
      expect(claimPortsFile(file, dir, pickWhileTheOtherWins)).toEqual(winner);
      expect(onDisk()).toEqual({ checkout: dir, ...winner });
      expect(readdirSync(dir)).toEqual([".dev-ports.json"]);
    });

    it("replaces a file made for another checkout", () => {
      writeFileSync(file, JSON.stringify({ checkout: "/elsewhere", ...winner }));
      expect(claimPortsFile(file, dir, () => worktree)).toEqual(worktree);
      expect(onDisk()).toEqual({ checkout: dir, ...worktree });
      expect(readdirSync(dir)).toEqual([".dev-ports.json"]);
    });

    it("leaves a file it can't read alone and names it", () => {
      writeFileSync(file, "{ not json");
      expect(() => claimPortsFile(file, dir, () => worktree)).toThrow(`${file} can't be read`);
      expect(readFileSync(file, "utf8")).toBe("{ not json");
    });
  });
});
