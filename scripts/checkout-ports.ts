// This checkout's dev-server ports (#157): from API_PORT and WEB_PORT, else the main checkout's
// defaults, else a linked worktree's .dev-ports.json, made the first time anything asks. The
// decisions live in dev-ports-plan.ts, which has the tests; this gathers the facts.
import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  devPortsFileName,
  listeningPorts,
  mainCheckoutPorts,
  parseDevPortsFile,
  pickPortBlock,
  portsOf,
  readDevPortsFile,
  resolveDevPorts,
  worktreePaths,
  type CheckoutPorts,
  type PortPair,
} from "./dev-ports-plan.ts";
import { capture, checkoutRoot } from "./processes.ts";

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * The ports in `file`, made for `checkout` with `pick` when it's missing or names another
 * checkout. It's created exclusively and with no lock: when two servers start together, the one
 * that loses the race reads the winner's file. A file that can't be read throws and stays as is.
 */
export function claimPortsFile(
  file: string,
  checkout: string,
  pick: () => CheckoutPorts,
): CheckoutPorts {
  const existing = readIfExists(file);
  const current = existing === undefined ? undefined : readDevPortsFile(existing, file, checkout);
  if (current) return current;

  // Written whole to a file of its own first, so no reader ever sees a half-written one.
  const draft = `${file}.${process.pid}.tmp`;
  writeFileSync(draft, `${JSON.stringify({ checkout, ...pick() }, null, 2)}\n`);
  try {
    if (existing === undefined) linkSync(draft, file);
    else renameSync(draft, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    rmSync(draft, { force: true });
  }
  const claimed = readDevPortsFile(readFileSync(file, "utf8"), file, checkout);
  if (!claimed) throw new Error(`${file} was just written for another checkout. Delete it.`);
  return claimed;
}

/** Whether `root` is the main checkout, whose git dir isn't a linked worktree's. */
function isMainCheckout(root: string): boolean {
  const dirs = capture(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
    root,
  );
  if (!dirs.ok) return true;
  const [gitDir, commonDir] = dirs.stdout.trim().split("\n");
  return resolve(gitDir) === resolve(commonDir);
}

/** Every checkout's path, the main checkout first. */
export function worktrees(): string[] {
  return worktreePaths(capture("git", ["worktree", "list", "--porcelain"]).stdout);
}

/**
 * The ports `path`'s .dev-ports.json gives it, undefined when it has none (or one made for
 * another checkout), or a note when it can't be read. Never creates a file.
 */
export function assignedPorts(path: string): CheckoutPorts | undefined | string {
  const file = join(path, devPortsFileName);
  const text = readIfExists(file);
  if (text === undefined) return undefined;
  try {
    return readDevPortsFile(text, file, path);
  } catch {
    return `can't read ${devPortsFileName}`;
  }
}

/** A free block: none of its ports is in another worktree's file or has a listener. */
function pickFreeBlock(root: string): CheckoutPorts {
  const claimed = worktrees()
    .filter((path) => path !== root)
    .flatMap((path) => {
      const text = readIfExists(join(path, devPortsFileName));
      if (text === undefined) return [];
      try {
        return portsOf(parseDevPortsFile(text, path));
      } catch {
        return [];
      }
    });
  const lsof = capture("lsof", ["-nP", "-iTCP:20000-29999", "-sTCP:LISTEN", "-Fn"]);
  return pickPortBlock(claimed, listeningPorts(lsof.stdout));
}

let cached: CheckoutPorts | undefined;

/** This checkout's test and prod ports. In a linked worktree, makes its file the first time. */
export function checkoutPorts(): CheckoutPorts {
  if (cached) return cached;
  const root = checkoutRoot();
  cached =
    !root || isMainCheckout(root)
      ? mainCheckoutPorts
      : claimPortsFile(join(root, devPortsFileName), root, () => pickFreeBlock(root));
  return cached;
}

/** The API and web ports for this checkout and the running APP_ENV. */
export function devPorts(env: NodeJS.ProcessEnv = process.env): PortPair {
  return resolveDevPorts(env, checkoutPorts);
}
