import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // One .env at the repo root; the browser only ever sees its VITE_-prefixed values.
  envDir: "..",
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
