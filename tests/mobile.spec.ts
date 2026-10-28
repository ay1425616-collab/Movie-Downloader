import { test, expect } from "@playwright/test";
test("mobile catalog renders without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:8787");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: /The Last Lighthouse/ }).click();
  await expect(
    page.getByText("No authorized files are currently available."),
  ).toBeVisible();
});
