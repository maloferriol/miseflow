// `npm run e2e` runs this before Playwright. Playwright starts its own API and web app, and a
// server already on their ports would be tested in their place, or hang its start-up check.
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

const e2ePorts = [8787, 5173];

/** Whether anything accepts a connection on the port, on 127.0.0.1 or ::1. */
async function listening(port: number) {
  const tries = ["127.0.0.1", "::1"].map(
    (host) =>
      new Promise<boolean>((resolve) => {
        const socket = connect({ port, host, timeout: 1000 });
        const done = (open: boolean) => {
          socket.destroy();
          resolve(open);
        };
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
        // Something holds the port but doesn't answer: still taken.
        socket.once("timeout", () => done(true));
      }),
  );
  return (await Promise.all(tries)).some(Boolean);
}

/** The message naming the ports already in use, or undefined when they are all free. */
export async function takenPortsProblem(ports: number[] = e2ePorts) {
  const taken = [];
  for (const port of ports) if (await listening(port)) taken.push(port);
  if (taken.length === 0) return undefined;
  const which = taken.length === 1 ? `Port ${taken[0]} is` : `Ports ${taken.join(" and ")} are`;
  return (
    `${which} already in use. npm run e2e starts its own API and web app, ` +
    "so stop every dev server (this checkout's too) and rerun."
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problem = await takenPortsProblem();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
