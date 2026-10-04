import { expect, type Locator, type Page } from "@playwright/test";
import { expectPageNotBlank, expectPageReady } from "../../utils/assertions";
import { assertValidInssaUrl } from "../../utils/env";

const DEFAULT_TIMEOUT = 15_000;
const INVALID_LOGIN_PATTERN =
  /wrong password|invalid|incorrect|unable to sign in|sign in failed|login failed|try again/i;

export class AuthPage {
  constructor(private readonly page: Page) {}

  async goToSignIn(next?: "/timecapsule"): Promise<void> {
    assertValidInssaUrl();
    const response = await this.page.goto(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin", { waitUntil: "domcontentloaded" });
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
    await this.stagingBoundary("SESSION_NOT_ESTABLISHED", async () => {
      let state = "pending";
      await expect.poll(async () => {
        const authenticated = await this.page.evaluate((email) => Object.entries(localStorage).some(([key, value]) => {
          if (!key.startsWith("firebase:authUser:")) return false;
          try {
            const user = JSON.parse(value);
            return typeof user?.uid === "string" && user.uid.length > 0 &&
              user.email?.toLowerCase() === email.toLowerCase();
          } catch { return false; }
        }), expectedEmail);
        state = authenticated ? "authenticated" : await this.invalidLoginSignals().isVisible() ? "rejected" : "pending";
        return state;
      }, { message: "Expected Firebase to authenticate the requested account.", timeout: DEFAULT_TIMEOUT }).not.toBe("pending");
      if (state === "rejected") {
        throw new Error("AUTHENTICATION_REJECTED: INSSA rejected the submitted credentials.");
      }
    });
    await this.stagingBoundary("PROFILE_INITIALIZATION_FAILED", async () => {
      await expect.poll(() => this.page.evaluate((email) => {
        try {
          const profile = JSON.parse(localStorage.getItem("userProfile") ?? "null")?.state?.userProfile;
          return Object.entries(localStorage).some(([key, value]) => {
            if (!key.startsWith("firebase:authUser:")) return false;
            const user = JSON.parse(value);
            return typeof user?.uid === "string" && user.uid.length > 0 &&
              user.email?.toLowerCase() === email.toLowerCase() && profile?.uid === user.uid;
          });
        } catch { return false; }
      }, expectedEmail), {
        message: "Expected the requested INSSA account and its matching profile to finish initializing.",
        timeout: DEFAULT_TIMEOUT
      }).toBe(true);
    });
  }

  async expectStagingLoginReady(expectedEmail: string): Promise<void> {
    await this.expectAuthenticatedSession(expectedEmail);
    await this.stagingBoundary("PROFILE_INITIALIZATION_FAILED", async () => {
      await expect(this.page.getByRole("heading", { name: "Signing in...", exact: true, includeHidden: true })).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect.poll(() => new URL(this.page.url()).pathname, { timeout: DEFAULT_TIMEOUT }).not.toMatch(/^\/signin\/?$/);
    });
  }

  async signOutStaging(expectedEmail: string): Promise<void> {
    // Persisted identity and its matching profile must be ready before the
    // document navigation. Landing-page overlays are unrelated to this check.
    await this.expectStagingLoginReady(expectedEmail);
    await this.stagingBoundary("AUTHENTICATED_PROFILE_ROUTE_FAILED", async () => {
      await this.goToProfile();
      await expect.poll(() => new URL(this.page.url()).pathname, {
        message: "Expected /me to resolve to an authenticated INSSA profile route.",
        timeout: DEFAULT_TIMEOUT
      }).toMatch(/^\/(?:me(?:\/|$)|u\/[^/]+(?:\/|$)|profile(?:\/|$))/);
      await this.expectAuthenticatedSession(expectedEmail);
    });
    await this.stagingBoundary("LOGOUT_CONTROL_MISSING", async () => {
      await expect(this.signOutButton(), "Expected a visible Sign Out control on the authenticated profile.").toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(this.signOutButton()).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    });
    await this.stagingBoundary("LOGOUT_FAILED", async () => {
      await this.signOutButton().click();
      await expect.poll(() => this.page.evaluate(() => Object.entries(localStorage).some(([key, value]) => {
        if (!key.startsWith("firebase:authUser:")) return false;
        try { return Boolean(JSON.parse(value)?.uid); } catch { return true; }
      })), { message: "Expected real UI logout to remove the authenticated Firebase user.", timeout: DEFAULT_TIMEOUT }).toBe(false);
      await this.expectStagingPublicState();
    });
  }

  private async expectStagingPublicState(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect(this.page.getByRole("button", { name: /sign out|log out|logout/i, includeHidden: true })).toHaveCount(0);
    await expect.poll(() => new URL(this.page.url()).pathname, {
      message: "Expected logout to leave the authenticated profile route.",
      timeout: DEFAULT_TIMEOUT
    }).not.toMatch(/^\/(?:me(?:\/|$)|u\/[^/]+(?:\/|$)|profile(?:\/|$))/);
    // Same public Sign In/onboarding contract as the monitor's existing
    // expectLoggedOutState, after Firebase removal has already been proven.
    const publicSignal = this.page.locator("a[href='/signin']").filter({ hasText: /^sign in$/i })
      .or(this.page.getByRole("button", { name: /^(?:Skip|Skip onboarding|Next)$/ }))
      .filter({ visible: true });
    await expect(publicSignal.first(), "Expected public Sign In or onboarding after logout.").toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  private async stagingBoundary(code: string, check: () => Promise<void>): Promise<void> {
    try { await check(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/^AUTHENTICATION_REJECTED:/.test(message)) throw error;
      throw new Error(`${code}: ${message}`, { cause: error });
    }
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
