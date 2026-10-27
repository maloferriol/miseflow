import { expect, test } from "@playwright/test";

test("signs in, builds a Menu, keeps it after a reload, and opens it again from the list", async ({
  page,
}) => {
  // The local test user keeps its Menus between runs, so this run's Menu gets its own name.
  const menuName = `Saturday dinner ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByLabel("Menu name").fill(menuName);
  await page.getByLabel("Guests").fill("6");
  await page.getByRole("button", { name: "Create Menu" }).click();
  await expect(page.getByRole("heading", { name: menuName })).toBeVisible();

  await page.getByLabel("Course name").fill("Starter");
  await page.getByRole("button", { name: "Add Course" }).click();
  await expect(page.getByRole("heading", { name: "Starter" })).toBeVisible();

  await page.getByLabel("Recipe name").fill("Velouté");
  await page.getByRole("button", { name: "Add Dish" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Velouté" })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("heading", { name: menuName })).toBeVisible();
  await expect(page.getByText("6 guests")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Starter" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Velouté" })).toBeVisible();

  // A fresh visit to the start screen lists the Menu; opening it shows what was saved.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Your Menus" })
    .getByRole("link", { name: menuName })
    .click();
  await expect(page.getByRole("heading", { name: menuName })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Velouté" })).toBeVisible();
});
