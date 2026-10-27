// `npm run preflight`: gets a new local checkout ready to run the app and the tests, or stops at
// the first problem and names the fix. Run by hand from the checkout's root; running it again
// changes nothing. Node runs this file directly (type stripping), so it works before `npm ci`.
// The decisions live in preflight-checks.ts, which has the tests.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { assertLocalEnv } from "./local-only.ts";
import {
  dependenciesNeedInstall,
  nodeVersionProblem,
  parseLsof,
  portProblem,
  type Listener,
} from "./preflight-checks.ts";

const repoDir = fileURLToPath(new URL("..", import.meta.url));
const envFile = fileURLToPath(new URL("../.env", import.meta.url));

/** Runs a command quietly. `missing` means the command isn't installed. */
function capture(command: string, args: string[], cwd = repoDir) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30_000 });
  const missing = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  return { ok: result.status === 0, missing, stdout: result.stdout ?? "" };
}

/** Runs a command that fixes something, with its output shown. */
function run(command: string, args: string[]) {
  return spawnSync(command, args, { cwd: repoDir, stdio: "inherit" }).status === 0;
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

function warn(message: string) {
  console.warn(`! ${message}`);
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// 1. Required commands, in the order they're checked. The Supabase CLI resolves from node_modules
// (`npx supabase`), so it's checked once the dependencies are installed.
const requiredCommands: { name: string; afterInstall?: true; problem: () => string | undefined }[] =
  [
    { name: `Node ${process.version}`, problem: () => nodeVersionProblem(process.version) },
    {
      name: "Docker",
      problem() {
        const docker = capture("docker", ["info"]);
        if (docker.missing) return "Docker isn't installed. Install Docker Desktop, then rerun.";
        if (!docker.ok)
          return "The Docker daemon isn't answering. Start Docker Desktop, then rerun.";
      },
    },
    {
      name: "Supabase CLI",
      afterInstall: true,
      problem() {
        if (!capture("npx", ["--no-install", "supabase", "--version"]).ok)
          return "`npx supabase` doesn't resolve. Run `npm ci --ignore-scripts`, then rerun.";
      },
    },
  ];

function checkCommands(afterInstall: boolean) {
  for (const command of requiredCommands) {
    if (Boolean(command.afterInstall) !== afterInstall) continue;
    const problem = command.problem();
    if (problem) fail(problem);
    pass(command.name);
  }
}

checkCommands(false);

// gh is optional: cloud sessions use the GitHub MCP tools instead.
const gh = capture("gh", ["auth", "status"]);
if (gh.missing)
  warn("gh isn't installed. The issue tracker steps need it locally (`brew install gh`).");
else if (!gh.ok)
  warn("gh isn't logged in. The issue tracker steps need it locally (`gh auth login`).");
else pass("gh");

// 2. Dependencies, installed the way CODING_STANDARDS.md and CI do it.
const installedAt = statSync(`${repoDir}node_modules/.package-lock.json`, {
  throwIfNoEntry: false,
})?.mtimeMs;
const lockfileAt = statSync(`${repoDir}package-lock.json`).mtimeMs;
if (dependenciesNeedInstall({ installedAt, lockfileAt })) {
  console.log("Installing dependencies (npm ci --ignore-scripts)…");
  if (!run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]))
    fail("`npm ci --ignore-scripts` failed. Fix the error above, then rerun.");
}
pass("Dependencies");

checkCommands(true);

// 3. This checkout's own .env. Never copy another checkout's: each one resets the shared test user.
if (!existsSync(envFile)) {
  console.log("Writing .env (npm run setup:local)…");
  if (!run("npm", ["run", "setup:local"]))
    fail("`npm run setup:local` failed. Fix the error above, then rerun.");
}
const env = parseEnv(readFileSync(envFile, "utf8"));
try {
  assertLocalEnv("npm run preflight", env);
} catch (error) {
  fail(`.env: ${(error as Error).message}`);
}
try {
  // The scripts load .env without overriding the shell, so a cloud value there wins.
  assertLocalEnv("npm run preflight", process.env);
} catch (error) {
  fail(`Your shell: ${(error as Error).message} Unset it in this shell, then rerun.`);
}
pass(".env");

// 4. The local Supabase stack, shared by every worktree (so its ports are expected to be in use).
const stackDown = "The local Supabase stack isn't running. Run `npx supabase start`, then rerun.";
if (!capture("npx", ["supabase", "status"]).ok) fail(stackDown);
const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;
if (!databaseUrl)
  fail("DATABASE_URL isn't set in .env. Delete .env, then rerun to write a fresh one.");
const { default: postgres } = await import("postgres");
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
try {
  await sql`select 1`;
} catch (error) {
  fail(`The database in .env refuses connections (${(error as Error).message}). ${stackDown}`);
} finally {
  await sql.end();
}
pass("Local Supabase stack");

// 5. The app ports. A dev server or e2e run from another checkout would serve that checkout's code.
const appPorts = [
  { port: 8787, name: "API" },
  { port: 5173, name: "web" },
];
const checkoutRoot = capture("git", ["rev-parse", "--show-toplevel"]).stdout.trim();
if (capture("lsof", ["-v"]).missing) {
  warn("lsof isn't installed, so the app ports weren't checked.");
} else {
  for (const port of appPorts) {
    const listening = capture("lsof", ["-nP", `-iTCP:${port.port}`, "-sTCP:LISTEN", "-Fpc"]);
    const listeners: Listener[] = parseLsof(listening.stdout).map(({ pid, command }) => {
      const cwd = parseLsof(capture("lsof", ["-a", "-p", `${pid}`, "-d", "cwd", "-Fn"]).stdout)[0]
        ?.name;
      const top = cwd ? capture("git", ["rev-parse", "--show-toplevel"], cwd) : undefined;
      return {
        pid,
        command: command ?? "a process",
        cwd,
        checkout: top?.ok ? top.stdout.trim() : undefined,
      };
    });
    const problem = portProblem(port, listeners, checkoutRoot);
    if (problem) fail(problem);
  }
  pass(`Ports ${appPorts.map((p) => p.port).join(" and ")} are free or this checkout's`);
}

console.log("\nPreflight passed: this checkout is ready. Next, `npm run db:migrate`.");
