// The process facts `npm run preflight` and `npm run dev:stop` gather: who listens on a port, each
// process's working directory and the checkout it sits in. Parsing lives in preflight-checks.ts.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseLsof, type Listener } from "./preflight-checks.ts";

const repoDir = fileURLToPath(new URL("..", import.meta.url));

/** Runs a command quietly. `missing` means the command isn't installed. */
export function capture(command: string, args: string[], cwd = repoDir) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30_000 });
  const missing = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  return { ok: result.status === 0, missing, stdout: result.stdout ?? "" };
}

const checkouts = new Map<string, string | undefined>();

/** This checkout's git top level. */
export function checkoutRoot(): string {
  return checkoutOf(repoDir) ?? "";
}

/** The git top level of `cwd`, or undefined when it's unknown or not in a checkout. */
export function checkoutOf(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  if (!checkouts.has(cwd)) {
    const top = capture("git", ["rev-parse", "--show-toplevel"], cwd);
    checkouts.set(cwd, top.ok ? top.stdout.trim() : undefined);
  }
  return checkouts.get(cwd);
}

/** The working directory of each of `pids` that lsof can read. */
export function workingDirectories(pids: number[]): Map<number, string> {
  if (pids.length === 0) return new Map();
  const output = capture("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fn"]).stdout;
  return new Map(parseLsof(output).flatMap(({ pid, name }) => (name ? [[pid, name]] : [])));
}

/** The processes listening on TCP `port`. */
export function listenersOn(port: number): Listener[] {
  const listening = capture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
  const processes = parseLsof(listening.stdout);
  const cwds = workingDirectories(processes.map(({ pid }) => pid));
  return processes.map(({ pid, command }) => ({
    pid,
    command: command ?? "a process",
    cwd: cwds.get(pid),
    checkout: checkoutOf(cwds.get(pid)),
  }));
}
