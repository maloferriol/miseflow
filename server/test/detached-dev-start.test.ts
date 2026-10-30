import { describe, expect, it } from "vitest";
import { isDetachedDevStart } from "../../scripts/detached-dev-start.ts";

// The PreToolUse hook (.claude/hooks/refuse-detached-dev-start.ts) refuses these Bash commands.
describe("a detached dev-server start", () => {
  it("is refused with a trailing &", () => {
    expect(isDetachedDevStart("npm run dev:server &")).toBe(true);
    expect(isDetachedDevStart("npm run dev:web > web.log 2>&1 &")).toBe(true);
    expect(isDetachedDevStart("npm run dev:server & npm run dev:web")).toBe(true);
  });

  it("is refused behind nohup or setsid", () => {
    expect(isDetachedDevStart("nohup npm run dev:server")).toBe(true);
    expect(isDetachedDevStart("cd web && setsid npm run dev:web")).toBe(true);
  });

  it("is refused inside a ( … &) subshell", () => {
    expect(isDetachedDevStart("(npm run dev:server &)")).toBe(true);
    expect(isDetachedDevStart("( cd server && npm run dev:server & )")).toBe(true);
  });

  it("allows a foreground start, with arguments or in an && chain", () => {
    expect(isDetachedDevStart("npm run dev:server")).toBe(false);
    expect(isDetachedDevStart("npm run dev:server -- --foo")).toBe(false);
    expect(isDetachedDevStart("npm run build && npm run dev:web")).toBe(false);
    expect(isDetachedDevStart("npm run dev:server && echo stopped")).toBe(false);
  });

  it("allows redirects that contain &", () => {
    expect(isDetachedDevStart("npm run dev:server 2>&1 | tee server.log")).toBe(false);
    expect(isDetachedDevStart("npm run dev:web &> web.log")).toBe(false);
  });

  it("allows unrelated commands, and dev-server text inside quotes", () => {
    expect(isDetachedDevStart("npm run dev:prod &")).toBe(false);
    expect(isDetachedDevStart("nohup npm test")).toBe(false);
    expect(isDetachedDevStart('grep -n "npm run dev:server &" CODING_STANDARDS.md')).toBe(false);
  });
});
