// The decisions behind `npm run dev:stop` (scripts/dev-stop.ts): which of the app ports' listeners
// are this checkout's, and what to signal to stop each one's whole dev-server chain. The script
// gathers the facts (lsof, ps, git) and signals; this decides, so the tests need no processes.
import type { AppPort, Listener } from "./preflight-checks.ts";

/** One process from `ps`. `checkout` is the git top level of its cwd, when known. */
export type ProcessInfo = { pid: number; ppid: number; pgid: number; checkout: string | undefined };

/** Parses `ps -A -o pid=,ppid=,pgid=` output. */
export function parsePs(output: string): Omit<ProcessInfo, "checkout">[] {
  return output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
      return { pid, ppid, pgid };
    });
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
  ports: { port: AppPort; listeners: Listener[] }[];
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
      const at = `Port ${port.port} (${port.name}): `;
      if (listener.checkout !== checkoutRoot) {
        const where = listener.cwd ?? "an unknown directory";
        plan.leftAlone.push(
          `${at}left ${listener.command} (pid ${listener.pid}) running, started in ${where}, ` +
            "not this checkout.",
        );
        continue;
      }
      // It exited between lsof and ps.
      const own = byPid.get(listener.pid);
      if (!own) continue;
      const { pgid } = own;
      const members = processes.filter((p) => p.pgid === pgid);
      const what = `${listener.command} (pid ${listener.pid})`;
      if (members.every(isStoppable)) {
        plan.groups.push(pgid);
        plan.watch.push(...members.map((p) => p.pid));
        plan.stopping.push(`${at}stopping ${what} and its process group ${pgid}.`);
        continue;
      }
      // tsx watch restarts its node child, so the parents have to go too.
      const parents: number[] = [];
      for (
        let parent = byPid.get(own.ppid);
        parent && isStoppable(parent);
        parent = byPid.get(parent.ppid)
      )
        parents.push(parent.pid);
      plan.pids.push(listener.pid, ...parents);
      plan.watch.push(listener.pid, ...parents);
      const reason = members.some((p) => protectedPids.includes(p.pid))
        ? "it has processes that started dev:stop"
        : "it has processes outside this checkout";
      plan.stopping.push(
        `${at}stopping ${what} and its parents in this checkout (pids ${parents.join(", ")}), ` +
          `not its process group ${pgid}: ${reason}.`,
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
