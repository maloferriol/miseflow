// The decisions behind `npm run dev:stop` (scripts/dev-stop.ts): which of the app ports' listeners
// are this checkout's, and what to signal to stop each one's whole dev-server chain. The script
// gathers the facts (lsof, ps, git) and signals; this decides, so the tests need no processes.
import type { AppPort, Listener } from "./preflight-checks.ts";

/** One process from `ps`. `checkout` is the git top level of its cwd, when known. */
export type ProcessInfo = { pid: number; ppid: number; pgid: number; checkout: string | undefined };

type PsRow = Omit<ProcessInfo, "checkout">;
type PortListeners = { port: AppPort; listeners: Listener[] }[];

/** Parses `ps -A -o pid=,ppid=,pgid=` output. */
export function parsePs(output: string): PsRow[] {
  return output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
      return { pid, ppid, pgid };
    });
}

/** `pid`'s parent, grandparent and so on, nearest first, stopping before init (pid 1). */
export function parentsOf(pid: number, processes: PsRow[]): number[] {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const parents: number[] = [];
  for (let p = byPid.get(byPid.get(pid)?.ppid ?? 0); p && p.pid > 1; p = byPid.get(p.ppid))
    parents.push(p.pid);
  return parents;
}

/**
 * The processes whose checkout planDevStop reads: the process groups and parents of this
 * checkout's listeners. Looking up only these keeps dev:stop to one lsof and a few git calls.
 */
export function processesToResolve(
  ports: PortListeners,
  processes: PsRow[],
  checkoutRoot: string,
): number[] {
  const pids = new Set<number>();
  for (const { listeners } of ports)
    for (const listener of listeners) {
      if (listener.checkout !== checkoutRoot) continue;
      const pgid = processes.find((p) => p.pid === listener.pid)?.pgid;
      for (const p of processes) if (p.pgid === pgid) pids.add(p.pid);
      for (const pid of parentsOf(listener.pid, processes)) pids.add(pid);
    }
  return [...pids];
}

export type DevStopPlan = {
  /** Process groups to signal whole. */
  groups: number[];
  /** Single processes to signal. */
  pids: number[];
  /** Every process that should be gone once the signals land. */
  watch: number[];
  /** One line per listener being stopped. */
  stopping: string[];
  /** One line per listener left running because it isn't this checkout's. */
  leftAlone: string[];
};

export function planDevStop({
  ports,
  processes,
  checkoutRoot,
  protectedPids,
}: {
  ports: PortListeners;
  processes: ProcessInfo[];
  checkoutRoot: string;
  /** dev:stop's own process and its parents, which may sit in this checkout too. */
  protectedPids: number[];
}): DevStopPlan {
  const plan: DevStopPlan = { groups: [], pids: [], watch: [], stopping: [], leftAlone: [] };
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const isStoppable = (p: ProcessInfo) =>
    p.checkout === checkoutRoot && !protectedPids.includes(p.pid);
  for (const { port, listeners } of ports) {
    for (const listener of listeners) {
      const prefix = `Port ${port.port} (${port.name}): `;
      if (listener.checkout !== checkoutRoot) {
        const where = listener.cwd ?? "an unknown directory";
        plan.leftAlone.push(
          `${prefix}left ${listener.command} (pid ${listener.pid}) running, started in ${where}, ` +
            "not this checkout.",
        );
        continue;
      }
      // Undefined when it exited between lsof and ps.
      const pgid = byPid.get(listener.pid)?.pgid;
      if (pgid === undefined) continue;
      const members = processes.filter((p) => p.pgid === pgid);
      const label = `${listener.command} (pid ${listener.pid})`;
      if (members.every(isStoppable)) {
        plan.groups.push(pgid);
        plan.watch.push(...members.map((p) => p.pid));
        plan.stopping.push(`${prefix}stopping ${label} and its process group ${pgid}.`);
        continue;
      }
      // tsx watch restarts its node child, so the parents have to go too.
      const parents: number[] = [];
      for (const pid of parentsOf(listener.pid, processes)) {
        if (!isStoppable(byPid.get(pid)!)) break;
        parents.push(pid);
      }
      plan.pids.push(listener.pid, ...parents);
      plan.watch.push(listener.pid, ...parents);
      const reason = members.some((p) => protectedPids.includes(p.pid))
        ? "it has processes that started dev:stop"
        : "it has processes outside this checkout";
      const withParents = parents.length
        ? ` and its parents in this checkout (pids ${parents.join(", ")})`
        : "";
      plan.stopping.push(
        `${prefix}stopping ${label}${withParents}, not its process group ${pgid}: ${reason}.`,
      );
    }
  }
  // One shell can start both dev servers, so their listeners can share a group and parents.
  const unique = (values: number[]) => [...new Set(values)];
  return {
    ...plan,
    groups: unique(plan.groups),
    pids: unique(plan.pids),
    watch: unique(plan.watch),
  };
}
