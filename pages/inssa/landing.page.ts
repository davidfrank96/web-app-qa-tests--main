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
    await this.dismissLandingOverlaysIfPresent();
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
    await this.dismissLandingOverlaysIfPresent();
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
    await this.dismissLandingOverlaysIfPresent();
    const chooser = this.page.getByText(INSSA_FIND_CHOOSER_PATTERN).first();
    if (!(await chooser.isVisible({ timeout: 1_000 }).catch(() => false))) {
      await expect(this.findButton()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await this.findButton().click();
    }
    await expect(chooser, "Expected Find to open the nearby capsule chooser.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
  }

  async openBuryEntry(): Promise<void> {
    await this.dismissLandingOverlaysIfPresent();
    const buryButton = this.buryButton();
    await expect(buryButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(buryButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    await this.page.waitForTimeout(500);
    await buryButton.click();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  signInLink(): Locator {
    return this.page.locator("a").filter({ hasText: INSSA_SIGN_IN_PATTERN }).first();
  }

  findButton(): Locator {
    return this.page.locator("button:visible").filter({ hasText: INSSA_FIND_BUTTON_PATTERN }).first();
  }

  buryButton(): Locator {
    return this.page.locator("button:visible").filter({ hasText: INSSA_BURY_BUTTON_PATTERN }).first();
  }

  searchField(): Locator {
    return this.page
      .locator("input[placeholder*='Search for any place' i], input[type='text']")
      .first();
  }

  private async dismissLandingOverlaysIfPresent(): Promise<void> {
    await this.dismissBrowserSessionWarningIfPresent();
    const landingState = await expect
      .poll(() => this.page.locator("body").innerText().catch(() => ""), {
        message: "Expected onboarding or landing controls to render.",
        timeout: DEFAULT_TIMEOUT
      })
      .toMatch(/Plan anywhere you want to go\.|FIND anywhere|Find|Bury|Search for any place/i)
      .then(() => this.page.locator("body").innerText())
      .catch(() => "");

    if (/Plan anywhere you want to go\.|FIND anywhere/i.test(landingState)) {
      const onboardingSkip = this.page.getByRole("button", { name: /^Skip$/i }).first();
      await expect(onboardingSkip, "Expected onboarding carousel to expose Skip.").toBeVisible({
        timeout: DEFAULT_TIMEOUT
      });
      await onboardingSkip.click();
      await expect(
        this.page.locator("body"),
        "Expected onboarding carousel to dismiss before validating landing controls."
      ).not.toContainText(/Plan anywhere you want to go\.|FIND anywhere/i, { timeout: DEFAULT_TIMEOUT });
    }

    await this.dismissBrowserSessionWarningIfPresent();
    const locationPrompt = this.page.getByRole("dialog", { name: /Unlock what's near you/i }).first();
    if (await locationPrompt.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const origin = new URL(this.page.url()).origin;
      await this.page.context().setGeolocation({ latitude: 53.3382, longitude: -6.2591 });
      await this.page.context().grantPermissions(["geolocation"], { origin });
      await this.page.getByRole("button", { name: /Use my location/i }).click();
      await expect(locationPrompt, "Expected location prompt to dismiss before validating landing controls.").not.toBeVisible({
        timeout: DEFAULT_TIMEOUT
      });
    }
  }

  private async dismissBrowserSessionWarningIfPresent(): Promise<void> {
    const browserSessionDismiss = this.page.getByRole("button", { name: /^Got it$/i }).first();
    if (await browserSessionDismiss.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await browserSessionDismiss.click();
      await expect(browserSessionDismiss, "Expected browser session warning to dismiss.").not.toBeVisible({
        timeout: DEFAULT_TIMEOUT
      });
    }
  }
}
