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

    if (await this.authenticatedSignal().isVisible().catch(() => false)) {
      return;
    }

    await this.goToProfile();
    await this.expectProfileSurface();
  }

  async expectProfileSurface(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect(
      this.profileSignal(),
      "Expected authenticated profile UI such as Sign Out, Edit Profile, My Contacts, or a profile route."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
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
      this.page.getByRole("link", { name: /sign in/i }),
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

  private profileSignal(): Locator {
    return this.page
      .locator("button, a[href]")
      .filter({ hasText: /sign out|edit profile|my contacts|requests|alerts|following|loved/i })
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
