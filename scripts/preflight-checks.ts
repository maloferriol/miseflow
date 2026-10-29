// The pass-or-fail decisions behind `npm run preflight` (scripts/preflight.ts). The script gathers
// the facts (versions, file times, port listeners) and these decide, so the tests need no machine.

/** package.json "engines". */
const minimumNodeMajor = 24;

/** The major of `version`, as in `process.version` ("v24.11.0" is 24). */
export function nodeMajor(version: string): number {
  return Number(/^v?(\d+)\./.exec(version)?.[1]);
}

/** A message naming the problem and its fix, or undefined when `version` (as in `process.version`) is new enough. */
export function nodeVersionProblem(version: string): string | undefined {
  if (nodeMajor(version) >= minimumNodeMajor) return undefined;
  return (
    `Node ${version} is too old: this repo needs ${minimumNodeMajor} or later. ` +
    `Install it, for example with \`nvm install ${minimumNodeMajor}\`.`
  );
}

/**
 * `installedAt` is when npm last wrote node_modules (its node_modules/.package-lock.json, undefined
 * when missing) and `lockfileAt` when package-lock.json changed, both in ms. A pull that changes the
 * lockfile makes node_modules older than it.
 */
export function dependenciesNeedInstall(times: {
  installedAt: number | undefined;
  lockfileAt: number;
}): boolean {
  return times.installedAt === undefined || times.installedAt < times.lockfileAt;
}

/** One process from `lsof -F`: its pid, and the command (`c`) or file name (`n`) fields asked for. */
export type LsofProcess = { pid: number; command?: string; name?: string };

/** Parses `lsof -F` output: a `p<pid>` line starts each process, and other lines are its fields. */
export function parseLsof(output: string): LsofProcess[] {
  const processes: LsofProcess[] = [];
  for (const line of output.split("\n")) {
    const value = line.slice(1);
    if (line.startsWith("p")) processes.push({ pid: Number(value) });
    else if (line.startsWith("c")) processes.at(-1)!.command = value;
    else if (line.startsWith("n")) processes.at(-1)!.name = value;
  }
  return processes;
}

/** A process listening on an app port. `checkout` is the git top level of its `cwd`, when known. */
export type Listener = {
  pid: number;
  command: string;
  cwd: string | undefined;
  checkout: string | undefined;
};

/**
 * A message naming the process and its directory, or undefined when every listener on `port` was
 * started from `checkoutRoot`. Comparing git top levels, not path prefixes, matters because
 * worktrees sit inside the main checkout (.claude/worktrees/).
 */
export function portProblem(
  port: { port: number; name: string },
  listeners: Listener[],
  checkoutRoot: string,
): string | undefined {
  const other = listeners.find((listener) => listener.checkout !== checkoutRoot);
  if (!other) return undefined;
  const where = other.cwd ?? "an unknown directory";
  return (
    `Port ${port.port} (${port.name}) is held by ${other.command} (pid ${other.pid}), ` +
    `started in ${where}, not this checkout. Stop it there, or run \`kill ${other.pid}\`.`
  );
}
