import { describe, expect, it } from "vitest";
import { parsePs, planDevStop } from "../../scripts/dev-stop-plan.ts";
import { appPorts } from "../../scripts/preflight-checks.ts";

// `npm run dev:stop` stops what this decides; the script itself only gathers the facts and signals.
describe("dev:stop", () => {
  const here = "/Users/cook/miseflow/.claude/worktrees/menus";
  const [api, web] = appPorts;

  it("reads pid, parent and process group from ps", () => {
    expect(parsePs("    1     0     1\n41133 41100 41100\n")).toEqual([
      { pid: 1, ppid: 0, pgid: 1 },
      { pid: 41133, ppid: 41100, pgid: 41100 },
    ]);
  });

  it("stops nothing when no app port has a listener", () => {
    const plan = planDevStop({
      ports: [
        { port: api, listeners: [] },
        { port: web, listeners: [] },
      ],
      processes: [],
      checkoutRoot: here,
      protectedPids: [],
    });

    expect(plan).toEqual({ groups: [], pids: [], watch: [], stopping: [], leftAlone: [] });
  });

  // `npm run dev:server` from the Bash tool: the shell leads one process group holding
  // npm run dev:server → npm run dev → tsx watch → node, and only node listens.
  const serverChain = (checkout: string | undefined, leader = 100) => [
    { pid: leader, ppid: 1, pgid: leader, checkout },
    { pid: leader + 1, ppid: leader, pgid: leader, checkout },
    { pid: leader + 2, ppid: leader + 1, pgid: leader, checkout },
    { pid: leader + 3, ppid: leader + 2, pgid: leader, checkout },
    { pid: leader + 4, ppid: leader + 3, pgid: leader, checkout },
  ];

  it("stops this checkout's listener with its whole process group", () => {
    const listener = { pid: 104, command: "node", cwd: `${here}/server`, checkout: here };

    const plan = planDevStop({
      ports: [
        { port: api, listeners: [listener] },
        { port: web, listeners: [] },
      ],
      processes: [{ pid: 1, ppid: 0, pgid: 1, checkout: undefined }, ...serverChain(here)],
      checkoutRoot: here,
      protectedPids: [],
    });

    expect(plan).toEqual({
      groups: [100],
      pids: [],
      watch: [100, 101, 102, 103, 104],
      stopping: ["Port 8787 (API): stopping node (pid 104) and its process group 100."],
      leftAlone: [],
    });
  });

  it("skips a listener that exited before ps listed the processes", () => {
    const listener = { pid: 104, command: "node", cwd: `${here}/server`, checkout: here };

    const plan = planDevStop({
      ports: [{ port: api, listeners: [listener] }],
      processes: serverChain(here).slice(0, 4),
      checkoutRoot: here,
      protectedPids: [],
    });

    expect(plan).toEqual({ groups: [], pids: [], watch: [], stopping: [], leftAlone: [] });
  });

  it("signals a group once when both app ports' listeners are in it", () => {
    // `npm run dev:server` and `npm run dev:web` started from one shell.
    const vite = { pid: 105, ppid: 100, pgid: 100, checkout: here };
    const server = { pid: 104, command: "node", cwd: `${here}/server`, checkout: here };
    const webServer = { pid: 105, command: "node", cwd: `${here}/web`, checkout: here };

    const plan = planDevStop({
      ports: [
        { port: api, listeners: [server] },
        { port: web, listeners: [webServer] },
      ],
      processes: [...serverChain(here), vite],
      checkoutRoot: here,
      protectedPids: [],
    });

    expect(plan.groups).toEqual([100]);
    expect(plan.watch).toEqual([100, 101, 102, 103, 104, 105]);
    expect(plan.stopping).toEqual([
      "Port 8787 (API): stopping node (pid 104) and its process group 100.",
      "Port 5173 (web): stopping node (pid 105) and its process group 100.",
    ]);
  });

  it("leaves another checkout's listener, or one whose checkout is unknown, running", () => {
    const main = "/Users/cook/miseflow";
    const other = { pid: 204, command: "node", cwd: `${main}/server`, checkout: main };
    const unknown = { pid: 304, command: "python3", cwd: undefined, checkout: undefined };

    const plan = planDevStop({
      ports: [
        { port: api, listeners: [other] },
        { port: web, listeners: [unknown] },
      ],
      processes: [...serverChain(main, 200), ...serverChain(undefined, 300)],
      checkoutRoot: here,
      protectedPids: [],
    });

    expect(plan).toEqual({
      groups: [],
      pids: [],
      watch: [],
      stopping: [],
      leftAlone: [
        "Port 8787 (API): left node (pid 204) running, started in /Users/cook/miseflow/server, " +
          "not this checkout.",
        "Port 5173 (web): left python3 (pid 304) running, started in an unknown directory, " +
          "not this checkout.",
      ],
    });
  });

  it("stops only the listener and its parents in this checkout when its group reaches outside", () => {
    // The shell leading the group was started in the main checkout, then cd'd into this one.
    const [shell, ...rest] = serverChain(here);
    const listener = { pid: 104, command: "node", cwd: `${here}/server`, checkout: here };

    const plan = planDevStop({
      ports: [{ port: api, listeners: [listener] }],
      processes: [{ ...shell, checkout: "/Users/cook/miseflow" }, ...rest],
      checkoutRoot: here,
      protectedPids: [],
    });

    expect(plan).toEqual({
      groups: [],
      pids: [104, 103, 102, 101],
      watch: [104, 103, 102, 101],
      stopping: [
        "Port 8787 (API): stopping node (pid 104) and its parents in this checkout " +
          "(pids 103, 102, 101), not its process group 100: it has processes outside this checkout.",
      ],
      leftAlone: [],
    });
  });

  it("never stops the processes that started dev:stop, even in this checkout", () => {
    // Claude Code (pid 50, in this checkout) leads the group its Bash shells run in.
    const agent = { pid: 50, ppid: 1, pgid: 50, checkout: here };
    const chain = serverChain(here).map((p) => ({
      ...p,
      pgid: 50,
      ppid: p.ppid === 1 ? 50 : p.ppid,
    }));
    const listener = { pid: 104, command: "node", cwd: `${here}/server`, checkout: here };

    const plan = planDevStop({
      ports: [{ port: api, listeners: [listener] }],
      processes: [agent, ...chain],
      checkoutRoot: here,
      protectedPids: [50],
    });

    expect(plan).toEqual({
      groups: [],
      pids: [104, 103, 102, 101, 100],
      watch: [104, 103, 102, 101, 100],
      stopping: [
        "Port 8787 (API): stopping node (pid 104) and its parents in this checkout " +
          "(pids 103, 102, 101, 100), not its process group 50: it has processes that started " +
          "dev:stop.",
      ],
      leftAlone: [],
    });
  });
});
