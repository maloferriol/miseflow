import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { apiUrl, pickE2ePorts } from "../../scripts/e2e-ports.ts";

// Each `npm run e2e` starts its own API and web app on ports nothing else uses, so two worktrees
// can run it at the same time (#156).
describe("e2e ports", () => {
  const servers: Server[] = [];
  afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))));

  async function listen(host: string) {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    return (server.address() as { port: number }).port;
  }

  async function accepts(port: number) {
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, resolve);
      });
      return true;
    } catch {
      return false;
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  it("picks two different free ports and writes them to the env", async () => {
    const env: NodeJS.ProcessEnv = {};
    const ports = await pickE2ePorts(env);
    expect(ports.api).not.toBe(ports.web);
    expect(await accepts(ports.api)).toBe(true);
    expect(await accepts(ports.web)).toBe(true);
    expect(env).toEqual({ E2E_API_PORT: `${ports.api}`, E2E_WEB_PORT: `${ports.web}` });
  });

  it("never picks a port something already listens on, over IPv4 or IPv6", async () => {
    const taken = [await listen("127.0.0.1"), await listen("::1")];
    for (let i = 0; i < 20; i++) {
      const { api, web } = await pickE2ePorts({});
      expect(taken).not.toContain(api);
      expect(taken).not.toContain(web);
    }
  });

  it("keeps the ports already in the env, so the runner's workers use the runner's", async () => {
    const env: NodeJS.ProcessEnv = { E2E_API_PORT: "41001", E2E_WEB_PORT: "41002" };
    expect(await pickE2ePorts(env)).toEqual({ api: 41001, web: 41002 });
    expect(env).toEqual({ E2E_API_PORT: "41001", E2E_WEB_PORT: "41002" });
  });

  it("builds a URL on this run's API", () => {
    expect(apiUrl("/mutate", { E2E_API_PORT: "41001" })).toBe("http://localhost:41001/mutate");
  });

  it("refuses to build an API URL outside an e2e run, rather than guess a port", () => {
    expect(() => apiUrl("/mutate", {})).toThrow(
      "E2E_API_PORT is not set. Only npm run e2e starts this run's API.",
    );
  });
});
