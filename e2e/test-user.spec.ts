import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createTestUser, deleteTestUser, sweepTestUsers, type TestUser } from "./test-user.ts";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

test.afterAll(async () => {
  await sql.end();
});

// Every public table with an owner_id, read from the database rather than the schema.
async function rowsOwnedBy(ownerId: string) {
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'owner_id' order by table_name`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from ${sql(table_name)} where owner_id = ${ownerId}`;
    if (row.n > 0) counts[table_name] = row.n;
  }
  return counts;
}

// A Recipe with one Step whose line links the seed's butter, and the mutation that made it.
async function writeRecipe(user: TestUser) {
  const recipeId = randomUUID();
  const stepId = randomUUID();
  await sql`insert into recipes (id, owner_id, name) values (${recipeId}, ${user.id}, 'E2E cleanup')`;
  await sql`insert into steps (id, owner_id, recipe_id, position) values (${stepId}, ${user.id}, ${recipeId}, 'a0')`;
  await sql`
    insert into ingredient_lines (id, owner_id, step_id, ingredient_id, position)
    select ${randomUUID()}, ${user.id}, ${stepId}, id, 'a0' from ingredients
    where owner_id is null and name = 'butter'`;
  await sql`insert into applied_mutations (id, owner_id, name) values (${randomUUID()}, ${user.id}, 'createRecipe')`;
  return recipeId;
}

test("refuses a cloud .env before it connects", async () => {
  await expect(
    createTestUser("test-user", { ...process.env, SUPABASE_URL: "https://abcdefgh.supabase.co" }),
  ).rejects.toThrow(
    "runs only against the local Supabase stack, but SUPABASE_URL points at abcdefgh.supabase.co",
  );
});

test("creates a fresh user whose token the API accepts, and deletes it so it can no longer sign in", async ({
  request,
}) => {
  const user = await createTestUser("test-user");
  expect(user.email).toMatch(/^e2e-test-user-[0-9a-f]+@miseflow\.test$/);
  const res = await request.get("http://localhost:8787/menus", {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  expect(res.status(), await res.text()).toBe(200);

  await deleteTestUser(user);
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  expect(error?.code).toBe("invalid_credentials");
});

test("deleting a user hard-deletes every row it owns and leaves another user's rows", async () => {
  const [user, other] = await Promise.all([
    createTestUser("test-user"),
    createTestUser("test-user"),
  ]);
  await writeRecipe(user);
  await writeRecipe(other);
  expect(await rowsOwnedBy(user.id)).toEqual({
    applied_mutations: 1,
    ingredient_lines: 1,
    recipes: 1,
    steps: 1,
  });

  await deleteTestUser(user);
  expect(await rowsOwnedBy(user.id)).toEqual({});
  expect(await rowsOwnedBy(other.id)).toEqual({
    applied_mutations: 1,
    ingredient_lines: 1,
    recipes: 1,
    steps: 1,
  });
  await deleteTestUser(other);
});

test("a delete that fails part-way leaves the user and every row it owns", async () => {
  const [user, other] = await Promise.all([
    createTestUser("test-user"),
    createTestUser("test-user"),
  ]);
  const recipeId = await writeRecipe(user);
  // Another user's Step on this user's Recipe: the Recipe can't go, so nothing may go.
  const stepId = randomUUID();
  await sql`insert into steps (id, owner_id, recipe_id, position) values (${stepId}, ${other.id}, ${recipeId}, 'a0')`;

  await expect(deleteTestUser(user)).rejects.toThrow("violates foreign key constraint");
  expect(await rowsOwnedBy(user.id)).toEqual({
    applied_mutations: 1,
    ingredient_lines: 1,
    recipes: 1,
    steps: 1,
  });
  expect(await sql`select 1 from auth.users where id = ${user.id}`).toHaveLength(1);

  await sql`delete from steps where id = ${stepId}`;
  await deleteTestUser(user);
  await deleteTestUser(other);
});

test("the sweep removes users an interrupted run left, with their rows, and no other owner's rows", async () => {
  // Scoped to this test's spec name, so it never sweeps the users of specs running alongside.
  const specName = `sweep-${randomBytes(4).toString("hex")}`;
  const [left, deletedEarlier] = await Promise.all([
    createTestUser(specName),
    createTestUser(specName),
  ]);
  await writeRecipe(left);
  await writeRecipe(deletedEarlier);
  // How deleteTestUser worked before #139: the auth user goes, its rows stay.
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.deleteUser(deletedEarlier.id);
  expect(error).toBeNull();
  // An owner that no longer exists and was never an e2e user, like an earlier cook@miseflow.test.
  const stranger = { ...left, id: randomUUID() };
  await writeRecipe(stranger);

  expect(await sweepTestUsers(specName)).toBe(2);
  expect(await rowsOwnedBy(left.id)).toEqual({});
  expect(await rowsOwnedBy(deletedEarlier.id)).toEqual({});
  expect(await sql`select 1 from auth.users where id = ${left.id}`).toHaveLength(0);
  expect(await rowsOwnedBy(stranger.id)).toEqual({
    applied_mutations: 1,
    ingredient_lines: 1,
    recipes: 1,
    steps: 1,
  });

  await sql.begin(async (tx) => {
    for (const table of ["ingredient_lines", "steps", "recipes", "applied_mutations"])
      await tx`delete from ${tx(table)} where owner_id = ${stranger.id}`;
  });
});
