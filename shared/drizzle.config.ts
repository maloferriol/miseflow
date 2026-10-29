import { defineConfig } from "drizzle-kit";
import { loadEnvIntoProcess } from "../scripts/env.ts";

// One env file for the whole run, picked by APP_ENV (ADR 0012).
loadEnvIntoProcess();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
