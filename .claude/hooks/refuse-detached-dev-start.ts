// PreToolUse hook on Bash: refuses a detached `npm run dev:server` or `dev:web` start, which the
// session couldn't stop later (CODING_STANDARDS.md). The decision lives in
// scripts/detached-dev-start.ts, which has the tests. Exit 2 blocks the call and shows stderr.
import { readFileSync } from "node:fs";
import { isDetachedDevStart } from "../../scripts/detached-dev-start.ts";

const input = JSON.parse(readFileSync(0, "utf8")) as { tool_input?: { command?: unknown } };
const command = input.tool_input?.command;
if (typeof command === "string" && isDetachedDevStart(command)) {
  console.error(
    "Refused: this starts a dev server detached (&, nohup, setsid or ( … &)), so this session " +
      "couldn't stop it later. Run it in the foreground with the Bash tool's run_in_background " +
      "instead, and stop it with TaskStop.",
  );
  process.exit(2);
}
