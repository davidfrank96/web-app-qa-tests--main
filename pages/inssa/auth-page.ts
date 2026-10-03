import { expect, type Locator, type Page } from "@playwright/test";
import { expectPageNotBlank, expectPageReady } from "../../utils/assertions";
import { assertValidInssaUrl } from "../../utils/env";

const DEFAULT_TIMEOUT = 15_000;
const INVALID_LOGIN_PATTERN =
  /wrong password|invalid|incorrect|unable to sign in|sign in failed|login failed|try again/i;

export class AuthPage {
  constructor(private readonly page: Page) {}

  async goToSignIn(): Promise<void> {
    assertValidInssaUrl();
    const response = await this.page.goto("/signin", { waitUntil: "domcontentloaded" });
    if (response && response.status() >= 400) {
      throw new Error(`INSSA sign-in page returned HTTP ${response.status()}.`);
    }

    await expectPageReady(this.page);
    await this.expectAuthFormVisible();
  }

  async goToProfile(): Promise<void> {
    assertValidInssaUrl();
    const response = await this.page.goto("/me", { waitUntil: "domcontentloaded" });
    if (response && response.status() >= 400) {
      throw new Error(`INSSA profile page returned HTTP ${response.status()}.`);
    }

    await expectPageReady(this.page);
  }

  async expectAuthFormVisible(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect(this.emailField(), "Expected a visible INSSA email field.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.passwordField(), "Expected a visible INSSA password field.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.submitButton(), "Expected a visible INSSA sign-in button.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    await this.submitEmailPassword(email, password);
    await this.waitForSuccessfulLoginTransition();
  }

  async submitEmailPassword(email: string, password: string): Promise<void> {
    await this.emailField().fill(email);
    await this.passwordField().fill(password);
    await this.submitButton().click();
  }

  async expectAuthenticatedState(): Promise<void> {
    await expectPageNotBlank(this.page);

    if (
      (await this.signOutButton().isVisible().catch(() => false)) ||
      (await this.authenticatedSignal().isVisible().catch(() => false))
    ) {
      return;
    }

    await this.goToProfile();
    await this.expectProfileSurface();
  }

  async expectAuthenticatedSession(expectedEmail: string): Promise<void> {
    await expect
      .poll(
        () =>
          this.page.evaluate((email) => {
            try {
              const profile = JSON.parse(localStorage.getItem("userProfile") ?? "null")?.state?.userProfile;
              return Object.entries(localStorage).some(([key, value]) => {
                if (!key.startsWith("firebase:authUser:")) return false;
                const user = JSON.parse(value);
                return typeof user?.uid === "string" && user.uid.length > 0 &&
                  user.email?.toLowerCase() === email.toLowerCase() && profile?.uid === user.uid;
              });
            } catch { return false; }
          }, expectedEmail),
        {
          message: "Expected the requested INSSA account and its matching profile to finish initializing.",
          timeout: DEFAULT_TIMEOUT
        }
      )
      .toBe(true);
  }

  async expectStagingLoginReady(expectedEmail: string): Promise<void> {
    await this.expectAuthenticatedSession(expectedEmail);
    await expect(this.page.getByRole("heading", { name: "Signing in...", exact: true, includeHidden: true })).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect.poll(() => new URL(this.page.url()).pathname, { timeout: DEFAULT_TIMEOUT }).not.toMatch(/^\/signin\/?$/);
  }

  async signOutStaging(expectedEmail: string): Promise<void> {
    await this.expectStagingLoginReady(expectedEmail);
    if (await this.page.getByText("Heads up about this browser session", { exact: true }).isVisible()) {
      await this.page.getByRole("button", { name: "Got it", exact: true }).click();
    }
    const skipOnboarding = this.page.getByRole("button", { name: "Skip onboarding", exact: true });
    if (await skipOnboarding.isVisible()) await skipOnboarding.click();
    // The profile link uses the product's SPA navigation. A document reload of
    // /me here aborts the still-running post-login account lookup.
    if (!(await this.signOutButton().isVisible())) {
      await this.page.getByRole("link", { name: /^Profile(?:, \d+ new)?$/ }).click();
    }
    await this.expectProfileSurface();
    await this.expectAuthenticatedSession(expectedEmail);
    await this.signOutButton().click();
    await expect.poll(() => this.page.evaluate(() => Object.entries(localStorage).some(([key, value]) => {
      if (!key.startsWith("firebase:authUser:")) return false;
      try { return Boolean(JSON.parse(value)?.uid); } catch { return true; }
    })), { message: "Expected real UI logout to remove the authenticated Firebase user.", timeout: DEFAULT_TIMEOUT }).toBe(false);
  }

  async expectProfileSurface(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect
      .poll(() => new URL(this.page.url()).pathname, {
        message: "Expected /me to resolve to an authenticated INSSA profile route.",
        timeout: DEFAULT_TIMEOUT
      })
      .toMatch(/^\/(?:me(?:\/|$)|u\/[^/]+(?:\/|$)|profile(?:\/|$))/);
    await expect(
      this.signOutButton(),
      "Expected the authenticated INSSA profile to expose an enabled Sign Out button."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(this.signOutButton()).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
  }

  async reloadAndExpectAuthenticated(): Promise<void> {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.expectAuthenticatedState();
  }

  async signOut(): Promise<void> {
    if (!(await this.signOutButton().isVisible().catch(() => false))) {
      await this.goToProfile();
    }

    await expect(this.signOutButton(), "Expected a visible Sign Out button for INSSA logout.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await this.signOutButton().click();
  }

  async expectPublicState(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect(
      this.page.locator("a[href='/signin']").filter({ hasText: /^sign in$/i }),
      "Expected the public INSSA state to expose a Sign In entry point after logout."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(this.signOutButton()).toHaveCount(0);
  }

  async expectInvalidLoginError(): Promise<void> {
    const errorSignal = this.invalidLoginSignals();
    await expect(
      errorSignal,
      "Expected a visible invalid login error message after submitting incorrect INSSA credentials."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  emailField(): Locator {
    return this.page
      .locator(
        [
          "input[type='email']",
          "input[autocomplete='email']",
          "input[name*='email' i]",
          "input[placeholder*='email' i]"
        ].join(", ")
      )
      .first();
  }

  passwordField(): Locator {
    return this.page
      .locator(
        [
          "input[type='password']",
          "input[autocomplete='current-password']",
          "input[name*='password' i]",
          "input[placeholder*='password' i]"
        ].join(", ")
      )
      .first();
  }

  submitButton(): Locator {
    return this.page.getByRole("button", { name: /^sign in$|^log in$|^continue$/i }).first();
  }

  signOutButton(): Locator {
    return this.page.getByRole("button", { name: /sign out|log out|logout/i }).first();
  }

  private authenticatedSignal(): Locator {
    return this.page
      .locator(
        [
          "a[href='/me']",
          "a[href^='/u/']",
          "a[href*='/profile']"
        ].join(", ")
      )
      .first();
  }

  private invalidLoginSignals(): Locator {
    return this.page
      .locator(
        [
          "[role='alert']",
          "[role='status']",
          "[aria-live='assertive']",
          "[aria-live='polite']",
          "p",
          "span",
          "div"
        ].join(", ")
      )
      .filter({ hasText: INVALID_LOGIN_PATTERN })
      .first();
  }

  private async waitForSuccessfulLoginTransition(): Promise<void> {
    const startUrl = this.page.url();
    const deadline = Date.now() + DEFAULT_TIMEOUT;

    while (Date.now() <= deadline) {
      const currentUrl = this.page.url();
      if (!/\/signin\/?$/.test(currentUrl) && currentUrl !== startUrl) {
        return;
      }

      if (await this.authenticatedSignal().isVisible().catch(() => false)) {
        return;
      }

      await this.page.waitForTimeout(250);
    }

    throw new Error("INSSA login did not transition away from the sign-in surface.");
  }
}
