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
const AUTHENTICATED_LANDING_READY_TIMEOUT = 45_000;
const LOCATION_PROMPT_OR_CONTROLS_TIMEOUT = 15_000;
const LOCATION_PROMPT_ATTEMPTS = 3;
const LOCATION_PROMPT_ATTEMPT_TIMEOUT = 10_000;

type AuthenticatedLandingReadiness = {
  buryEnabled: boolean;
  buryVisible: boolean;
  findEnabled: boolean;
  findVisible: boolean;
  locationPromptVisible: boolean;
  pointsLedgerVisible: boolean;
  searchVisible: boolean;
};

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
    const startedAt = Date.now();
    await expectPageNotBlank(this.page);
    await expect(this.page.locator("body")).not.toContainText(INSSA_GENERIC_JS_SHELL_PATTERN);
    await this.dismissLandingOverlaysIfPresent();

    try {
      await expect
        .poll(() => this.authenticatedLandingReadiness(), {
          message:
            "Expected the authenticated INSSA home to finish initialization with search, Find, Bury, and points-ledger controls ready.",
          timeout: AUTHENTICATED_LANDING_READY_TIMEOUT
        })
        .toEqual({
          buryEnabled: true,
          buryVisible: true,
          findEnabled: true,
          findVisible: true,
          locationPromptVisible: false,
          pointsLedgerVisible: true,
          searchVisible: true
        });
    } catch (error) {
      console.log(
        `INSSA_LANDING_READY_FAILURE ${JSON.stringify({
          elapsedMs: Date.now() - startedAt,
          route: this.safeCurrentRoute(),
          state: await this.authenticatedLandingReadiness()
        })}`
      );
      throw error;
    }

    console.log(
      `INSSA_LANDING_READY ${JSON.stringify({
        elapsedMs: Date.now() - startedAt,
        route: this.safeCurrentRoute(),
        surface: "authenticated"
      })}`
    );
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
    await buryButton.click();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  signInLink(): Locator {
    return this.page.locator("a").filter({ hasText: INSSA_SIGN_IN_PATTERN }).first();
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
    await this.dismissLocationPromptIfPresent();
  }

  private async dismissLocationPromptIfPresent(): Promise<void> {
    let observedState = "pending";
    await expect
      .poll(
        async () => {
          observedState = await this.locationOrLandingControlState();
          return observedState;
        },
        {
          message: "Expected either the location prompt or primary landing controls to become observable.",
          timeout: LOCATION_PROMPT_OR_CONTROLS_TIMEOUT
        }
      )
      .not.toBe("pending");

    if (observedState !== "location-prompt") {
      return;
    }

    const origin = new URL(this.page.url()).origin;
    await this.page.context().setGeolocation({ latitude: 53.3382, longitude: -6.2591 });
    await this.page.context().grantPermissions(["geolocation"], { origin });

    for (let attempt = 1; attempt <= LOCATION_PROMPT_ATTEMPTS; attempt += 1) {
      const locationPrompt = this.locationPrompt();
      if (!(await locationPrompt.isVisible({ timeout: 500 }).catch(() => false))) {
        return;
      }

      const useLocationButton = locationPrompt.getByRole("button", { name: /Use my location/i }).first();
      try {
        await expect(useLocationButton, "Expected the current location consent button to be visible.").toBeVisible({
          timeout: LOCATION_PROMPT_ATTEMPT_TIMEOUT
        });
        await expect(useLocationButton, "Expected the current location consent button to be enabled.").toBeEnabled({
          timeout: LOCATION_PROMPT_ATTEMPT_TIMEOUT
        });
        await useLocationButton.click({ timeout: LOCATION_PROMPT_ATTEMPT_TIMEOUT });
        await expect(
          this.locationPrompt(),
          "Expected location prompt to dismiss before validating landing controls."
        ).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
        return;
      } catch (error) {
        const promptStillVisible = await this.locationPrompt().isVisible({ timeout: 500 }).catch(() => false);
        if (!promptStillVisible) {
          return;
        }
        if (attempt === LOCATION_PROMPT_ATTEMPTS || !this.isTransientLocationPromptError(error)) {
          throw error;
        }
      }
    }
  }

  private locationPrompt(): Locator {
    return this.page.getByRole("dialog", { name: /Unlock what's near you/i }).first();
  }

  private async authenticatedLandingReadiness(): Promise<AuthenticatedLandingReadiness> {
    const [
      buryEnabled,
      buryVisible,
      findEnabled,
      findVisible,
      locationPromptVisible,
      pointsLedgerVisible,
      searchVisible
    ] = await Promise.all([
      this.buryButton().isEnabled().catch(() => false),
      this.buryButton().isVisible().catch(() => false),
      this.findButton().isEnabled().catch(() => false),
      this.findButton().isVisible().catch(() => false),
      this.locationPrompt().isVisible().catch(() => false),
      this.page.locator("a[href='/points-ledger']").first().isVisible().catch(() => false),
      this.searchField().isVisible().catch(() => false)
    ]);

    return {
      buryEnabled,
      buryVisible,
      findEnabled,
      findVisible,
      locationPromptVisible,
      pointsLedgerVisible,
      searchVisible
    };
  }

  private async locationOrLandingControlState(): Promise<"landing-controls" | "location-prompt" | "pending"> {
    if (await this.locationPrompt().isVisible().catch(() => false)) {
      return "location-prompt";
    }

    const [buryVisible, findVisible] = await Promise.all([
      this.buryButton().isVisible().catch(() => false),
      this.findButton().isVisible().catch(() => false)
    ]);
    return buryVisible && findVisible ? "landing-controls" : "pending";
  }

  private safeCurrentRoute(): string {
    try {
      const current = new URL(this.page.url());
      return `${current.origin}${current.pathname}`;
    } catch {
      return "unavailable";
    }
  }

  private isTransientLocationPromptError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return /element.*(?:detached|not attached|not stable)|not visible|locator no longer visible|(?:use my location.*timeout|timeout.*use my location)/is.test(
      error.message
    );
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
