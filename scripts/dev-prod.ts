// `npm run dev:prod`: the API and the web app together, both reading .env.prod (APP_ENV=prod), so
// signing in and saving hit the prod project. The server refuses to start while migrations are
// pending. Not guarded by assertLocalEnv (that is for tests) and uses no test user.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env, APP_ENV: "prod" };

const children = [
  spawn("npm", ["run", "dev", "-w", "server"], { cwd: root, env, stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "web"], { cwd: root, env, stdio: "inherit" }),
];

function stopAll(code: number): never {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

// Either one ending (the server refusing to start, say) stops the other.
for (const child of children) child.on("exit", (code) => stopAll(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stopAll(0));
