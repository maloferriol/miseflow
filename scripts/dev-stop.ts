// `npm run dev:stop`: stops this checkout's dev servers on the app ports, each with its whole
// `npm run dev:*` chain, and leaves other checkouts' running. The permission check refuses `kill`
// because it can't tell who started a process; this can. The SessionEnd hook runs it with
// --quiet, which prints only what it stopped or failed to stop.
// The decisions live in dev-stop-plan.ts, which has the tests.
import { parsePs, planDevStop, type ProcessInfo } from "./dev-stop-plan.ts";
import { appPorts } from "./preflight-checks.ts";
import { capture, checkoutOf, checkoutRoot, listenersOn, workingDirectories } from "./processes.ts";

const quiet = process.argv.includes("--quiet");
const graceMs = 5_000;

if (capture("lsof", ["-v"]).missing) {
  console.warn("! lsof isn't installed, so dev:stop can't find the app ports' listeners.");
  process.exit(0);
}

const root = checkoutRoot();
const ports = appPorts.map((port) => ({ port, listeners: listenersOn(port.port) }));
const table = parsePs(capture("ps", ["-A", "-o", "pid=,ppid=,pgid="]).stdout);
const byPid = new Map(table.map((p) => [p.pid, p]));

const ancestry = (pid: number) => {
  const chain: number[] = [];
  for (let p = byPid.get(pid); p && p.pid > 1; p = byPid.get(p.ppid)) chain.push(p.pid);
  return chain;
};

// Only the groups and parents of this checkout's listeners need a checkout: one lsof, and one git
// call per directory.
const relevant = new Set<number>();
for (const { listeners } of ports)
  for (const listener of listeners.filter((l) => l.checkout === root)) {
    const pgid = byPid.get(listener.pid)?.pgid;
    for (const p of table) if (p.pgid === pgid) relevant.add(p.pid);
    for (const pid of ancestry(listener.pid)) relevant.add(pid);
  }
const cwds = workingDirectories([...relevant]);
const processes: ProcessInfo[] = table.map((p) => ({
  ...p,
  checkout: relevant.has(p.pid) ? checkoutOf(cwds.get(p.pid)) : undefined,
}));

const plan = planDevStop({
  ports,
  processes,
  checkoutRoot: root,
  protectedPids: ancestry(process.pid),
});

if (!quiet) for (const line of plan.leftAlone) console.log(line);
if (plan.watch.length === 0) {
  if (!quiet)
    console.log(
      `Nothing to stop: no dev server from this checkout is listening on ` +
        `${appPorts.map((p) => p.port).join(" or ")}.`,
    );
  process.exit(0);
}
for (const line of plan.stopping) console.log(line);

/** Sends `signal`, ignoring a process that's already gone. A negative target is a process group. */
function send(target: number, signal: NodeJS.Signals) {
  try {
    process.kill(target, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function survivorsAfter(ms: number) {
  const until = Date.now() + ms;
  for (;;) {
    const alive = plan.watch.filter(isAlive);
    if (alive.length === 0 || Date.now() >= until) return alive;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

for (const pgid of plan.groups) send(-pgid, "SIGTERM");
for (const pid of plan.pids) send(pid, "SIGTERM");
let alive = await survivorsAfter(graceMs);
if (alive.length > 0) {
  console.log(`Still running after ${graceMs / 1000}s, so killing pids ${alive.join(", ")}.`);
  for (const pid of alive) send(pid, "SIGKILL");
  alive = await survivorsAfter(1_000);
}
if (alive.length > 0) {
  console.error(`✗ Couldn't stop pids ${alive.join(", ")}.`);
  process.exit(1);
}
console.log("Stopped this checkout's dev servers.");
