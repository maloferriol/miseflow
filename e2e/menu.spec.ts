import { expect, test } from "@playwright/test";

test("signs in, builds a Menu with a Course and a Dish, and keeps them after a reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByLabel("Menu name").fill("Saturday dinner");
  await page.getByLabel("Guests").fill("6");
  await page.getByRole("button", { name: "Create Menu" }).click();
  await expect(page.getByRole("heading", { name: "Saturday dinner" })).toBeVisible();

  await page.getByLabel("Course name").fill("Starter");
  await page.getByRole("button", { name: "Add Course" }).click();
  await expect(page.getByRole("heading", { name: "Starter" })).toBeVisible();

  await page.getByLabel("Recipe name").fill("Velouté");
  await page.getByRole("button", { name: "Add Dish" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Velouté" })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("heading", { name: "Saturday dinner" })).toBeVisible();
  await expect(page.getByText("6 guests")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Starter" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Velouté" })).toBeVisible();
});
