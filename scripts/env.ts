// The one env loader (ADR 0012). Every part of a run reads exactly one git-ignored file at the repo
// root, picked by APP_ENV: `.env.test` (unset or "test", the local Supabase stack) or `.env.prod`
// (the hosted project). Nothing else reads `.env`, `.env.local` or a Vite mode file.
// Plain TypeScript with node: imports only, so Node, tsx, Vite, Vitest, drizzle-kit and Playwright
// can all load it.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** The file name for an APP_ENV value. Throws for anything but unset, "test" or "prod". */
export function envFileName(appEnv: string | undefined): ".env.test" | ".env.prod" {
  if (appEnv === undefined || appEnv === "" || appEnv === "test") return ".env.test";
  if (appEnv === "prod") return ".env.prod";
  throw new Error(
    `APP_ENV is "${appEnv}", but it must be "test" or "prod" (unset means test). Fix or unset APP_ENV.`,
  );
}

/**
 * The values of exactly one env file. Throws for an unknown APP_ENV and for a missing file; the
 * messages name the fix and never include a value.
 */
export function loadEnv(
  appEnv: string | undefined = process.env.APP_ENV,
  root: string = repoRoot,
): Record<string, string> {
  const name = envFileName(appEnv);
  const file = `${root.replace(/\/$/, "")}/${name}`;
  if (!existsSync(file)) {
    const fix =
      name === ".env.test"
        ? "Run `npm run setup:local` to write it."
        : "Create it from the Supabase dashboard (README: Prod setup; .env.example lists the names).";
    throw new Error(`${name} is missing at the repo root. ${fix}`);
  }
  return parseEnv(readFileSync(file, "utf8")) as Record<string, string>;
}

/** Puts values into an env object, never overriding what the shell already set. */
export function applyEnv(values: Record<string, string>, target: NodeJS.ProcessEnv = process.env) {
  for (const [name, value] of Object.entries(values)) target[name] ??= value;
}

/** Loads the chosen env file into process.env. Returns the values it read. */
export function loadEnvIntoProcess(
  appEnv: string | undefined = process.env.APP_ENV,
  root: string = repoRoot,
) {
  const values = loadEnv(appEnv, root);
  applyEnv(values);
  return values;
}

/** The VITE_-prefixed values for the browser; a shell value wins, as with the server. */
export function viteEnv(
  appEnv: string | undefined = process.env.APP_ENV,
  root: string = repoRoot,
  shell: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...loadEnv(appEnv, root), ...shell }))
    if (name.startsWith("VITE_") && value !== undefined) picked[name] = value;
  return picked;
}

/** Warnings for env files from before ADR 0012. Nothing is renamed or deleted. */
export function legacyEnvWarnings(root: string = repoRoot): string[] {
  const base = root.replace(/\/$/, "");
  const warnings: string[] = [];
  if (existsSync(`${base}/.env`))
    warnings.push(
      ".env is no longer read. Rename it to .env.test (the local stack) or delete it, then run `npm run setup:local` if .env.test is missing.",
    );
  if (existsSync(`${base}/.env.local`))
    warnings.push(
      ".env.local is no longer read. If it holds the hosted project's values, rename it to .env.prod (README: Prod setup); otherwise delete it.",
    );
  return warnings;
}
