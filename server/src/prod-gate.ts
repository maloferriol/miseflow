import {
  prodStartupCheck,
  readAvailableMigrations,
  withMigrationSql,
} from "../../scripts/migration-gate.ts";
import { databaseUrlFromEnv } from "./env.ts";

type Check = (databaseUrl: string) => Promise<string | undefined>;

const checkMigrations: Check = (databaseUrl) =>
  withMigrationSql(databaseUrl, (sql) => prodStartupCheck(sql, readAvailableMigrations()));

/**
 * Against prod the server refuses to start on an old schema (ADR 0012). Returns the message to
 * print when it must not start, undefined when it may. The message never carries a connection string.
 */
export async function prodStartupRefusal(
  appEnv: string | undefined,
  readDatabaseUrl: () => string = databaseUrlFromEnv,
  check: Check = checkMigrations,
): Promise<string | undefined> {
  if (appEnv !== "prod") return undefined;
  try {
    return await check(readDatabaseUrl());
  } catch (error) {
    return error instanceof Error ? error.message : "Could not check prod's migrations.";
  }
}
