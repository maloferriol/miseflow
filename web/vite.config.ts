import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteEnv } from "../scripts/env.ts";

export default defineConfig({
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
  server: {
    // The API's routes sit at the root (/mutate, /menus); /api is only the dev proxy's prefix.
    // Source: https://vite.dev/config/server-options#server-proxy
    proxy: {
      "/api": {
        // npm run e2e points it at its own API; a dev server uses 8787.
        target: `http://localhost:${process.env.API_PORT ?? 8787}`,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
