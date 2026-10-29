// Import this first in a script's entry file: it loads the env file APP_ENV picks into process.env
// (ADR 0012). The imports after it read the values lazily, so the order is what matters.
import { loadEnvIntoProcess } from "./env.ts";

loadEnvIntoProcess();
