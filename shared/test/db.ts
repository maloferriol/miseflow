import { drizzle } from "drizzle-orm/postgres-js";
import { TransactionRollbackError } from "drizzle-orm";
import postgres from "postgres";
import type { Tx } from "../src/mutators/registry.ts";

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
export const db = drizzle({ client });

// Runs `fn` in a transaction that is always rolled back, so tests leave no rows behind.
export async function inRollback(fn: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}
