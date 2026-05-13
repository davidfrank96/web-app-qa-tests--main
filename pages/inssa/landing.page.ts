import { expect, type Locator, type Page } from "@playwright/test";
import { expectPageNotBlank, expectPageReady } from "../../utils/assertions";
import { assertValidInssaUrl } from "../../utils/env";
import {
  INSSA_BURY_BUTTON_PATTERN,
  INSSA_FIND_BUTTON_PATTERN,
  INSSA_FIND_CHOOSER_PATTERN,
  INSSA_GENERIC_JS_SHELL_PATTERN,
  INSSA_SIGN_IN_PATTERN
} from "../../utils/inssa-test-data";

const DEFAULT_TIMEOUT = 15_000;

export class LandingPage {
  constructor(private readonly page: Page) {}

  async goToHome(): Promise<void> {
    assertValidInssaUrl();
    const response = await this.page.goto("/", { waitUntil: "domcontentloaded" });
    if (response && response.status() >= 400) {
      throw new Error(`INSSA landing page returned HTTP ${response.status()}.`);
    }

    await expectPageReady(this.page);
  }

  async expectPublicLandingSurface(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect(this.page.locator("body")).not.toContainText(INSSA_GENERIC_JS_SHELL_PATTERN);
    await expect(this.searchField(), "Expected the INSSA landing page to show its search field.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.findButton(), "Expected the INSSA landing page to expose the Find action.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.buryButton(), "Expected the INSSA landing page to expose the Bury action.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.signInLink(), "Expected the INSSA landing page to expose Sign In.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
  }

  async expectAuthenticatedLandingSurface(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect(this.page.locator("body")).not.toContainText(INSSA_GENERIC_JS_SHELL_PATTERN);
    await expect(this.searchField(), "Expected the authenticated INSSA home to show the search field.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.findButton(), "Expected the authenticated INSSA home to expose the Find action.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.buryButton(), "Expected the authenticated INSSA home to expose the Bury action.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(
      this.page.locator("a[href='/points-ledger']").first(),
      "Expected the authenticated INSSA home to expose the points ledger link."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async openFindChooser(): Promise<void> {
    await expect(this.findButton()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await this.findButton().click();
    await expect(
      this.page.getByText(INSSA_FIND_CHOOSER_PATTERN).first(),
      "Expected Find to open the nearby capsule chooser."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async openBuryEntry(): Promise<void> {
    await expect(this.buryButton()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await this.buryButton().click();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  signInLink(): Locator {
    return this.page.getByRole("link", { name: INSSA_SIGN_IN_PATTERN }).first();
  }

  findButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_FIND_BUTTON_PATTERN }).first();
  }

  buryButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_BURY_BUTTON_PATTERN }).first();
  }

  searchField(): Locator {
    return this.page
      .locator("input[placeholder*='Search for any place' i], input[type='text']")
      .first();
  }
}
