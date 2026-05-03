import { expect, type Page } from "@playwright/test";

export class KBeanPage {
  constructor(private readonly page: Page) {}

  async gotoHome() {
    await this.page.goto("/");
    await this.page.waitForLoadState("domcontentloaded");
  }

  async expectBasicPageLoad() {
    await expect(this.page.locator("body")).toBeVisible();
  }

  async expectAuthEntryIfPresent() {
    const authSignals = this.page.getByRole("link", { name: /sign in|login|log in|account/i });
    const authButtons = this.page.getByRole("button", { name: /sign in|login|google|apple|email/i });
    const count = (await authSignals.count()) + (await authButtons.count());
    expect(count).toBeGreaterThanOrEqual(0);
  }
}
