import { drizzle } from "drizzle-orm/postgres-js";
import { sql, TransactionRollbackError } from "drizzle-orm";
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

// Two transactions on two connections. A runs `child` (an insert of a row that references a parent
// by foreign key, which takes FOR KEY SHARE on the parent) and stays open; B then runs `parent`
// with a short lock_timeout. FOR KEY SHARE conflicts with FOR UPDATE but not FOR NO KEY UPDATE, so
// B fails with "canceling statement due to lock timeout" only if it locks the parent FOR UPDATE.
// Both roll back. Source: https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS
export async function underUncommittedChild(
  child: (tx: Tx) => Promise<unknown>,
  parent: (tx: Tx) => Promise<void>,
) {
  const clients = [0, 1].map(() =>
    postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }),
  );
  const [a, b] = clients.map((client) => drizzle({ client }));
  let inserted!: () => void;
  const childInserted = new Promise<void>((resolve) => (inserted = resolve));
  let finish!: () => void;
  const bIsDone = new Promise<void>((resolve) => (finish = resolve));
  const rolledBack = (error: unknown) => {
    if (!(error instanceof TransactionRollbackError)) throw error;
  };
  try {
    const txA = a
      .transaction(async (tx) => {
        await child(tx);
        inserted();
        await bIsDone;
        tx.rollback();
      })
      .catch(rolledBack);
    await Promise.race([childInserted, txA]);
    const txB = b
      .transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '1s'`);
        await parent(tx);
        tx.rollback();
      })
      .catch(rolledBack)
      .finally(finish);
    const [resultA, resultB] = await Promise.allSettled([txA, txB]);
    for (const result of [resultB, resultA]) {
      if (result.status === "rejected")
        throw ((result.reason as Error).cause ?? result.reason) as Error;
    }
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}
