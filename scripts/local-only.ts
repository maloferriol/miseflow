// Tests, e2e and the local seed run only against the local Supabase stack. A .env with cloud
// values would otherwise point them at the real data, so stop before anything connects.
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const urlNames = ["DATABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL"];

/** Throws when one of the URLs that is set points anywhere but the local stack. */
export function assertLocalEnv(command: string, env: NodeJS.ProcessEnv = process.env) {
  for (const name of urlNames) {
    const value = env[name];
    if (!value) continue;
    // Only the host is named in the message: DATABASE_URL carries the password.
    const host = URL.canParse(value) ? new URL(value).hostname : undefined;
    if (host && localHosts.has(host)) continue;
    throw new Error(
      `${command} runs only against the local Supabase stack, but ${name} points at ` +
        `${host ?? "a URL that does not parse"}. Use the local .env that \`npm run setup:local\` writes.`,
    );
  }
}
