import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { checkoutEmail, checkoutUser } from "../../scripts/test-user.ts";
import { db, requireEnv } from "./helpers.ts";

const names = [`vitest-a-${process.pid}`, `vitest-b-${process.pid}`];

afterAll(async () => {
  for (const name of names)
    await db.execute(sql`delete from auth.users where email = ${checkoutEmail(name)}`);
});

async function signIn(email: string, password: string) {
  const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.auth.signInWithPassword({ email, password });
}

test("the email names the checkout, and different names never share one", () => {
  expect(checkoutEmail("miseflow")).toMatch(/^checkout-miseflow-[0-9a-f]{6}@miseflow\.test$/);
  expect(checkoutEmail("a_b")).not.toBe(checkoutEmail("a-b"));
  expect(checkoutEmail("a_b")).toBe(checkoutEmail("a_b"));
});

test("two checkouts get separate users, and refreshing one's password leaves the other signed in", async () => {
  const a = await checkoutUser(names[0]);
  const b = await checkoutUser(names[1]);
  expect(a.id).not.toBe(b.id);
  expect(a.email).not.toBe(b.email);

  const refreshed = await checkoutUser(names[0]);
  expect(refreshed.id).toBe(a.id);
  expect(refreshed.password).not.toBe(a.password);

  expect((await signIn(b.email, b.password)).error).toBeNull();
  expect((await signIn(refreshed.email, refreshed.password)).error).toBeNull();
  expect((await signIn(a.email, a.password)).error).not.toBeNull();
});
