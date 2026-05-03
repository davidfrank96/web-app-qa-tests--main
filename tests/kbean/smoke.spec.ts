import { test } from "@playwright/test";
import { KBeanPage } from "../../pages/kbean/kbean-page";

test.describe("KBean smoke checks", () => {
  test("landing page loads", async ({ page }) => {
    const kbean = new KBeanPage(page);
    await kbean.gotoHome();
    await kbean.expectBasicPageLoad();
  });

  test("auth entry points do not crash page", async ({ page }) => {
    const kbean = new KBeanPage(page);
    await kbean.gotoHome();
    await kbean.expectAuthEntryIfPresent();
  });
});
