import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./test-user.ts";

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
