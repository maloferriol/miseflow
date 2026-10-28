import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { takenPortsProblem } from "../../scripts/e2e-ports.ts";

// `npm run e2e` runs this first: Playwright would test whatever already serves its ports.
describe("e2e ports", () => {
  const servers: Server[] = [];
  afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))));

  async function listen(host: string) {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    return (server.address() as { port: number }).port;
  }

  it("names each port something already listens on, over IPv4 or IPv6", async () => {
    const v4 = await listen("127.0.0.1");
    const v6 = await listen("::1");
    expect(await takenPortsProblem([v4, v6])).toBe(
      `Ports ${v4} and ${v6} are already in use. npm run e2e starts its own API and web app, ` +
        "so stop every dev server (this checkout's too) and rerun.",
    );
  });

  it("passes when the ports are free", async () => {
    const port = await listen("127.0.0.1");
    await new Promise((r) => servers.pop()!.close(r));
    expect(await takenPortsProblem([port])).toBeUndefined();
  });
});
