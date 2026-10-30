// The decision behind the PreToolUse hook that refuses detached dev-server starts
// (.claude/hooks/refuse-detached-dev-start.ts). A detached server outlives the agent's control:
// the permission check refuses `kill` and `pkill`, so only a tracked background task can be stopped.

const devStart = /\bnpm\s+run\s+dev:(server|web)\b/;
const detacher = /(^|[\s(])(nohup|setsid)\s/;

/**
 * Splits a shell command at `&&`, `||`, `;`, `|`, newlines and a single `&`, keeping the
 * separators. Quoted text is dropped first, and an `&` in a redirect (`2>&1`, `&>`) doesn't split.
 */
function segments(command: string): { text: string; then: string }[] {
  const unquoted = command.replace(/"(\\.|[^"\\])*"|'[^']*'/g, "''");
  const parts = unquoted.split(/(&&|\|\||;|\||\n|(?<![>&])&(?![>&]))/);
  const result: { text: string; then: string }[] = [];
  for (let i = 0; i < parts.length; i += 2)
    result.push({ text: parts[i], then: parts[i + 1] ?? "" });
  return result;
}

/**
 * Whether `command` starts `npm run dev:server` or `npm run dev:web` so that it keeps running
 * after the shell exits: followed by a single `&` (also inside a `( … &)` subshell), or behind
 * `nohup` or `setsid`.
 */
export function isDetachedDevStart(command: string): boolean {
  return segments(command).some(
    ({ text, then }) => devStart.test(text) && (then === "&" || detacher.test(text)),
  );
}
