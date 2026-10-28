/**
 * The `supabase start` arguments for `npm run setup:local`. `exclude` is SUPABASE_START_EXCLUDE, a
 * comma-separated list of the CLI's container names; unset, every service in supabase/config.toml starts.
 */
export function supabaseStartArgs(exclude: string | undefined): string[] {
  const services = (exclude ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return services.length ? ["start", "-x", services.join(",")] : ["start"];
}

// Throwaway for #158: proves a lint error turns `check` red. Reverted before merge.
const throwawayUnused = 1;
