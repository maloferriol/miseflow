// The decisions behind each checkout's dev-server ports (#157): resolving them from the env, the
// checkout's .dev-ports.json or the main checkout's defaults. scripts/checkout-ports.ts gathers
// the facts (git, the file, lsof); these decide, so the tests need no machine.
import { envFileName } from "./env.ts";

export type PortPair = { api: number; web: number };

/** A checkout's ports for each APP_ENV. */
export type CheckoutPorts = { test: PortPair; prod: PortPair };

export const mainCheckoutPorts: CheckoutPorts = {
  test: { api: 8787, web: 5173 },
  prod: { api: 8788, web: 5174 },
};

type Env = Record<string, string | undefined>;

/** A port number from the env, or undefined when `name` is unset. */
function envPort(env: Env, name: "API_PORT" | "WEB_PORT"): number | undefined {
  const value = env[name];
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  if (!isPort(port))
    throw new Error(`${name} is "${value}", but it must be a port number (1 to 65535).`);
  return port;
}

function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

/**
 * The API and web ports for the running APP_ENV (unset means test, ADR 0012). `API_PORT` and
 * `WEB_PORT` win; `checkoutPorts` is asked only when one of them is unset, so setting both never
 * reads or creates a .dev-ports.json.
 */
export function resolveDevPorts(env: Env, checkoutPorts: () => CheckoutPorts): PortPair {
  const appEnv = envFileName(env.APP_ENV) === ".env.prod" ? "prod" : "test";
  const api = envPort(env, "API_PORT");
  const web = envPort(env, "WEB_PORT");
  if (api !== undefined && web !== undefined) return { api, web };
  const ports = checkoutPorts()[appEnv];
  return { api: api ?? ports.api, web: web ?? ports.web };
}

/** The file a linked worktree keeps its ports in, at its root and git-ignored. */
export const devPortsFileName = ".dev-ports.json";

/** What .dev-ports.json holds: the checkout it was made for, and its ports. */
export type DevPortsFile = { checkout: string } & CheckoutPorts;

function isPortPair(value: unknown): value is PortPair {
  if (typeof value !== "object" || value === null) return false;
  const { api, web } = value as Record<string, unknown>;
  return isPort(api) && isPort(web);
}

/** A .dev-ports.json's content. Throws, naming `file` and the fix, when it can't be read. */
export function parseDevPortsFile(text: string, file: string): DevPortsFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  const fields = (value ?? {}) as Record<string, unknown>;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof fields.checkout !== "string" ||
    !isPortPair(fields.test) ||
    !isPortPair(fields.prod)
  )
    throw new Error(
      `${file} can't be read as this checkout's dev ports. Delete it, and the next dev command ` +
        "picks new ports.",
    );
  return { checkout: fields.checkout, test: fields.test, prod: fields.prod };
}

/**
 * This checkout's ports from its .dev-ports.json, or undefined when the file names another
 * checkout (copied from another worktree), which counts as no file.
 */
export function readDevPortsFile(
  text: string,
  file: string,
  checkout: string,
): CheckoutPorts | undefined {
  const parsed = parseDevPortsFile(text, file);
  if (parsed.checkout !== checkout) return undefined;
  return { test: parsed.test, prod: parsed.prod };
}

const firstBlockPort = 20_000;
const lastBlockPort = 29_999;

/**
 * A worktree's ports: the first block of 4 consecutive ports from 20000 (test API, test web, prod
 * API, prod web) where no port is `claimed` by another worktree's .dev-ports.json or `listening`.
 */
export function pickPortBlock(
  claimed: Iterable<number>,
  listening: Iterable<number>,
): CheckoutPorts {
  const taken = new Set([...claimed, ...listening]);
  for (let base = firstBlockPort; base + 3 <= lastBlockPort; base += 4) {
    if ([0, 1, 2, 3].some((offset) => taken.has(base + offset))) continue;
    return { test: { api: base, web: base + 1 }, prod: { api: base + 2, web: base + 3 } };
  }
  throw new Error(
    `No block of 4 free ports is left between ${firstBlockPort} and ${lastBlockPort}: other ` +
      "worktrees' .dev-ports.json files claim them or something listens on them. Remove " +
      "worktrees you no longer use (`git worktree remove`), then try again.",
  );
}

/** Every port in `ports`, test and prod. */
export function portsOf(ports: CheckoutPorts): number[] {
  return [ports.test.api, ports.test.web, ports.prod.api, ports.prod.web];
}

/** Each checkout's path from `git worktree list --porcelain`, the main checkout first. */
export function worktreePaths(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/** The ports in `lsof -Fn` output for listening sockets ("n*:20000", "n[::1]:20002"). */
export function listeningPorts(lsofOutput: string): number[] {
  const ports = lsofOutput
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => Number(/:(\d+)$/.exec(line)?.[1]))
    .filter(isPort);
  return [...new Set(ports)];
}

/** One checkout in `npm run dev:ports`. `ports` is undefined when it has no file yet, or a note. */
export type DevPortsRow = {
  path: string;
  ports: CheckoutPorts | undefined | string;
  current: boolean;
};

const urlWidth = "http://localhost:20000".length + 2;

/** The `npm run dev:ports` table: each checkout's test and prod API and web URLs. */
export function devPortsTable(rows: DevPortsRow[]): string {
  const pathWidth = Math.max("Checkout".length, ...rows.map((row) => row.path.length)) + 1;
  const line = (mark: string, path: string, cells: string[]) =>
    `${mark} ${path.padEnd(pathWidth)}${cells.map((cell) => cell.padEnd(urlWidth)).join("")}`.trimEnd();
  const url = (port: number) => `http://localhost:${port}`;
  return [
    line(" ", "Checkout", ["Test API", "Test web", "Prod API", "Prod web"]),
    ...rows.map(({ path, ports, current }) =>
      line(
        current ? "*" : " ",
        path,
        typeof ports === "object" ? portsOf(ports).map(url) : [ports ?? "not assigned"],
      ),
    ),
    "",
    "* this checkout",
  ].join("\n");
}
