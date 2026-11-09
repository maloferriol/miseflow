import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devPorts } from "../scripts/checkout-ports.ts";
import { viteEnv } from "../scripts/env.ts";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Vite loads no env files of its own, so .env.local or a mode file can never override the chosen
  // environment (ADR 0012). Keep this even where it looks redundant: Vitest's "test" mode would
  // otherwise load .env.test by itself. The shared loader supplies the VITE_-prefixed values, and
  // only those reach the browser.
  envDir: false,
  define: Object.fromEntries(
    Object.entries(viteEnv()).map(([name, value]) => [
      `import.meta.env.${name}`,
      JSON.stringify(value),
    ]),
  ),
  // Only the dev server needs ports, so a build never makes a .dev-ports.json.
  server: command === "serve" ? devServer() : undefined,
}));

/**
 * This checkout's web port and its own API (scripts/checkout-ports.ts), read from the same
 * variables the API reads. strictPort makes a taken web port an error, not a move to the next port.
 */
function devServer() {
  const ports = devPorts();
  return {
    port: ports.web,
    strictPort: true,
    // The API's routes sit at the root (/mutate, /menus); /api is only the dev proxy's prefix.
    // Source: https://vite.dev/config/server-options#server-proxy
    proxy: {
      "/api": {
        target: `http://localhost:${ports.api}`,
        rewrite: (path: string) => path.replace(/^\/api/, ""),
      },
    },
  };
}
