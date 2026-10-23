import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Local development keeps its values in the repo root's git-ignored .env.
const rootEnv = new URL("../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
