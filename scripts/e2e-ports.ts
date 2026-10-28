// Each `npm run e2e` starts its own API and web app on ports nothing else is using, so two
// worktrees can run it at the same time and neither tests the other's servers (#156).
import { createServer, type Server } from "node:net";

export type E2ePorts = { api: number; web: number };

function listen(server: Server, port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, host, () => resolve(true));
  });
}

const close = (server: Server) => new Promise((r) => server.close(r));

/**
 * A port free on both 127.0.0.1 and ::1, held open on both so a second call can't get it.
 * The OS picks a port free on one address only, and localhost may resolve to either.
 */
async function holdFreePort(): Promise<{ servers: Server[]; port: number }> {
  for (;;) {
    const v4 = createServer();
    await listen(v4, 0, "127.0.0.1");
    const { port } = v4.address() as { port: number };
    const v6 = createServer();
    if (await listen(v6, port, "::1")) return { servers: [v4, v6], port };
    await close(v4);
  }
}

/**
 * This run's API and web ports. Playwright loads its config in the runner and again in each
 * worker, and the workers inherit the runner's process.env, so the runner picks free ports and
 * writes them to the env, and every later load reads them back.
 */
export async function pickE2ePorts(env: NodeJS.ProcessEnv = process.env): Promise<E2ePorts> {
  if (env.E2E_API_PORT && env.E2E_WEB_PORT)
    return { api: Number(env.E2E_API_PORT), web: Number(env.E2E_WEB_PORT) };
  const held = [await holdFreePort(), await holdFreePort()];
  await Promise.all(held.flatMap(({ servers }) => servers.map(close)));
  const [api, web] = held.map(({ port }) => port);
  env.E2E_API_PORT = `${api}`;
  env.E2E_WEB_PORT = `${web}`;
  return { api, web };
}

/** A URL on this run's API, for the specs that call it directly. */
export function apiUrl(path: string, env: NodeJS.ProcessEnv = process.env) {
  // No fallback to 8787: that would test whatever dev server holds it.
  if (!env.E2E_API_PORT)
    throw new Error("E2E_API_PORT is not set. Only npm run e2e starts this run's API.");
  return `http://localhost:${env.E2E_API_PORT}${path}`;
}
