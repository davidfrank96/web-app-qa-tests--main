import { test, expect } from "@playwright/test";

test.describe("Shared mobile smoke checks", () => {
  test("mobile page does not horizontally overflow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    expect(overflow).toBe(false);
  });
});
