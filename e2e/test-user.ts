import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "../shared/src/schema.ts";
import { assertLocalEnv } from "../scripts/local-only.ts";
import { requireEnv, runPid, type TestUser } from "../scripts/test-user.ts";

// The per-spec users and the checkout user live in scripts/test-user.ts (shared with the server
// tests); this file adds the cleanup and the run-wide checks that only e2e needs.
export { createTestUser, type TestUser } from "../scripts/test-user.ts";

/**
 * Every table with an owner_id, children before the tables they reference, so deleting in this
 * order satisfies the foreign keys. Read from the Drizzle schema, so a new table can't be missed.
 */
const ownedTables: string[] = (() => {
  const configs = Object.values(schema as Record<string, unknown>)
    .filter((value): value is PgTable => is(value, PgTable))
    .map(getTableConfig)
    .filter((config) => config.columns.some((column) => column.name === "owner_id"));
  const parents = new Map(
    configs.map((config) => [
      config.name,
      config.foreignKeys.map((fk) => getTableConfig(fk.reference().foreignTable).name),
    ]),
  );
  // Depth-first: a table goes in once every table that references it is in.
  const order: string[] = [];
  const visit = (name: string) => {
    if (order.includes(name)) return;
    for (const [child, refs] of parents) if (refs.includes(name) && child !== name) visit(child);
    order.push(name);
  };
  for (const name of parents.keys()) visit(name);
  return order;
})();

/** The runner pid a testUserEmail names, or undefined for a user from before #156. */
function runPidOf(email: string) {
  const pid = /^e2e-.+-[0-9a-f]{12}-(\d+)@miseflow\.test$/.exec(email)?.[1];
  return pid === undefined ? undefined : Number(pid);
}

/** Whether a process with this pid exists. Only this machine shares its local stack. */
function processIsLive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, under another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Runs `fn` on its own connection to the local database, and closes it. */
async function withDatabase<T>(env: NodeJS.ProcessEnv, fn: (sql: postgres.Sql) => Promise<T>) {
  const sql = postgres(requireEnv(env, "DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/**
 * Hard-deletes every row the users own, then the auth users, in one transaction, and returns how
 * many of them had a row or an auth user to delete.
 */
async function deleteUsersAndRows(sql: postgres.Sql, ids: string[]) {
  if (ids.length === 0) return 0;
  const deleted = new Set<string>();
  await sql.begin(async (tx) => {
    for (const table of ownedTables)
      for (const row of await tx<{ owner_id: string }[]>`
        delete from ${tx(table)} where owner_id = any(${ids}::uuid[]) returning owner_id`)
        deleted.add(row.owner_id);
    for (const row of await tx<{ id: string }[]>`
      delete from auth.users where id = any(${ids}::uuid[]) returning id`)
      deleted.add(row.id);
  });
  return deleted.size;
}

/** Hard-deletes every row the user owns, then the auth user, in one transaction. */
export async function deleteTestUser(user: TestUser) {
  assertLocalEnv("deleteTestUser");
  await withDatabase(process.env, (sql) => deleteUsersAndRows(sql, [user.id]));
}

/**
 * Hard-deletes the e2e users an ended run left behind, with their rows, and returns how many had
 * something left.
 * They are the users whose email is e2e-<specName>…@miseflow.test, plus users the auth audit log
 * names with such an email that are gone but whose rows stayed (deleteTestUser before #139),
 * except those of a run that is still going, in this worktree or another. A run is going while
 * its runner's pid is live; a reused pid only delays the sweep to a later run.
 * Rows with no owner and every other user's rows, cook@miseflow.test's included, are untouched.
 */
export async function sweepTestUsers(
  specName = "",
  env: NodeJS.ProcessEnv = process.env,
  isLive: (pid: number) => boolean = processIsLive,
) {
  assertLocalEnv("sweepTestUsers", env);
  return withDatabase(env, async (sql) => {
    const ids = await testUserIds(sql, specName, (pid) => pid === undefined || !isLive(pid));
    return deleteUsersAndRows(sql, ids);
  });
}

/**
 * The e2e users still in auth, and the ones the audit log names that are gone, whose run pid
 * `keep` accepts.
 */
async function testUserIds(
  sql: postgres.Sql,
  specName: string,
  keep: (pid: number | undefined) => boolean,
) {
  const email = `e2e-${specName}%@miseflow.test`;
  const users = await sql<{ id: string; email: string }[]>`
    select id, email from auth.users where email like ${email}
    union
    select (payload -> 'traits' ->> 'user_id')::uuid, payload -> 'traits' ->> 'user_email'
    from auth.audit_log_entries where payload -> 'traits' ->> 'user_email' like ${email}`;
  return [...new Set(users.filter(({ email }) => keep(runPidOf(email))).map(({ id }) => id))];
}

/**
 * What this run's e2e users still have: the auth users that remain and the rows they own, per
 * table. Another worktree's run, still going, has its own users.
 */
export async function testUserLeftovers(env: NodeJS.ProcessEnv = process.env) {
  assertLocalEnv("testUserLeftovers", env);
  const pid = runPid(env);
  return withDatabase(env, async (sql) => {
    const ids = await testUserIds(sql, "", (runPid) => runPid === pid);
    const [{ users }] = await sql<{ users: number }[]>`
      select count(*)::int as users from auth.users where id = any(${ids}::uuid[])`;
    const rows: Record<string, number> = {};
    for (const table of ownedTables) {
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from ${sql(table)} where owner_id = any(${ids}::uuid[])`;
      if (n > 0) rows[table] = n;
    }
    return { users, rows };
  });
}

/**
 * A count and a hash of the rows with no owner, per owned table. The catalog seed every user
 * and every worktree shares, so an e2e run must leave it as it found it.
 */
export async function seedFingerprint(env: NodeJS.ProcessEnv = process.env) {
  assertLocalEnv("seedFingerprint", env);
  return withDatabase(env, async (sql) => {
    const fingerprint: Record<string, string> = {};
    for (const table of ownedTables) {
      const [{ n, hash }] = await sql<{ n: number; hash: string }[]>`
        select count(*)::int as n, md5(coalesce(string_agg(t::text, ',' order by t.id), '')) as hash
        from ${sql(table)} t where t.owner_id is null`;
      fingerprint[table] = `${n} rows, md5 ${hash}`;
    }
    return fingerprint;
  });
}
