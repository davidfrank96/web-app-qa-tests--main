import { expect, type Locator, type Page } from "@playwright/test";
import {
  expectPageNotBlank,
  expectPageReady,
  expectVisibleInteractiveElements
} from "../../utils/assertions";
import { assertValidInssaUrl } from "../../utils/env";
import {
  INSSA_CONNECTIONS_PATTERN,
  INSSA_GENERIC_JS_SHELL_PATTERN,
  INSSA_POINTS_LEDGER_PATTERN,
  INSSA_PROFILE_SURFACE_PATTERN,
  INSSA_REQUESTS_PATTERN,
  INSSA_SETTINGS_PATTERN
} from "../../utils/inssa-test-data";

const DEFAULT_TIMEOUT = 15_000;
const AUTH_PATHS = ["/sign-in", "/signin", "/login", "/auth", "/onboarding", "/onboard", "/start"];
const AUTH_ROUTE_PATTERN = /^\/(?:sign-in|signin|login)(?:\/)?$|^\/(?:auth|onboarding|onboard|start)(?:\/|$)/i;
const AUTHENTICATED_ROUTE_PATTERN =
  /^\/(?:me|dashboard|profile|points-ledger|settings)(?:\/|$)|^\/u\/[^/]+|^\/timecapsule(?:\/|$)/i;
const PRIMARY_CTA_PATTERN = /sign in|log in|login|get started|continue|explore|join|start|learn more|find|bury/i;
const AUTH_SIGNAL_PATTERN = /sign in|log in|login|continue|get started|email|google|microsoft|apple|magic link|next/i;
const AUTHENTICATED_SIGNAL_PATTERN =
  /sign out|log out|logout|edit profile|my contacts|requests|alerts|following|loved|discard draft|save & exit|current plan|points/i;

export class InssaPage {
  constructor(private readonly page: Page) {}

  async goToHome() {
    await this.gotoPath("/");
  }

  async goToSignIn(): Promise<string> {
    for (const path of AUTH_PATHS) {
      const loaded = await this.gotoPath(path, { allowHttpError: true });
      if (!loaded) {
        continue;
      }

      if (await this.hasAuthSurface()) {
        return path;
      }
    }

    await this.goToHome();
    const beforeUrl = this.page.url();
    const authEntry = await this.findFirstVisible([
      this.page.getByRole("link", { name: AUTH_SIGNAL_PATTERN }),
      this.page.getByRole("button", { name: AUTH_SIGNAL_PATTERN })
    ]);

    expect(authEntry, "Expected an INSSA sign-in or onboarding entry point on the landing page.").not.toBeNull();
    await authEntry!.click();
    await expectPageReady(this.page);

    expect(
      this.page.url() !== beforeUrl || (await this.hasAuthSurface()),
      "Expected the INSSA sign-in or onboarding route to load without crashing."
    ).toBeTruthy();

    return this.page.url();
  }

  getPrimaryCTAs(): Locator {
    return this.page.locator(
      [
        "main a[href]",
        "main button",
        "[role='main'] a[href]",
        "[role='main'] button",
        "section a[href]",
        "section button"
      ].join(", ")
    );
  }

  getNavItems(): Locator {
    return this.page.locator(
      [
        "header a[href]",
        "header button",
        "nav a[href]",
        "nav button",
        "[role='banner'] a[href]",
        "[role='banner'] button",
        "[role='navigation'] a[href]",
        "[role='navigation'] button"
      ].join(", ")
    );
  }

  async expectHealthyPage() {
    await expectPageNotBlank(this.page);
  }

  async expectNoGenericShell() {
    await expect(
      this.page.locator("body"),
      "Expected INSSA to hydrate a real route surface instead of the generic JavaScript shell."
    ).not.toContainText(INSSA_GENERIC_JS_SHELL_PATTERN);
  }

  async goToPath(
    path: string,
    options: {
      allowHttpError?: boolean;
    } = {}
  ): Promise<boolean> {
    return this.gotoPath(path, options);
  }

  currentPath(): string {
    try {
      return new URL(this.page.url()).pathname;
    } catch {
      return this.page.url();
    }
  }

  isAuthRoute(url = this.page.url()): boolean {
    try {
      return AUTH_ROUTE_PATTERN.test(new URL(url).pathname);
    } catch {
      return AUTH_ROUTE_PATTERN.test(url);
    }
  }

  isAuthenticatedRoute(url = this.page.url()): boolean {
    try {
      return AUTHENTICATED_ROUTE_PATTERN.test(new URL(url).pathname);
    } catch {
      return AUTHENTICATED_ROUTE_PATTERN.test(url);
    }
  }

  async expectLandingCTAVisible() {
    const cta = await this.findFirstVisible([
      this.page.getByRole("link", { name: PRIMARY_CTA_PATTERN }),
      this.page.getByRole("button", { name: PRIMARY_CTA_PATTERN }),
      this.getPrimaryCTAs()
    ]);

    expect(cta, "Expected a visible primary CTA on the INSSA landing page.").not.toBeNull();
  }

  async expectAuthSurface() {
    const authElement = await this.findFirstVisible(this.authSurfaceLocators());
    expect(
      authElement,
      "Expected a visible form control or auth action on the INSSA sign-in or onboarding route."
    ).not.toBeNull();
  }

  async expectAuthenticatedSurface() {
    const authenticatedElement = await this.findFirstVisible(this.authenticatedSurfaceLocators());
    expect(
      authenticatedElement,
      "Expected authenticated INSSA UI such as Sign Out, Edit Profile, My Contacts, or Requests."
    ).not.toBeNull();
  }

  async expectPublicOrAuthEntrySurface() {
    const publicOrAuthEntry = await this.findFirstVisible(this.publicEntryLocators().concat(this.authSurfaceLocators()));
    expect(
      publicOrAuthEntry,
      "Expected the INSSA page to expose a public entry point or auth surface."
    ).not.toBeNull();
  }

  async expectNavigationSurface() {
    await expectVisibleInteractiveElements(
      this.getNavItems(),
      "Expected the INSSA header or navigation to expose visible actions."
    );
  }

  async expectAnyActionableButton() {
    await expectVisibleInteractiveElements(
      this.page.locator("button, a[href]"),
      "Expected at least one visible actionable element on the INSSA page."
    );
  }

  async hasAuthSurface(timeout = 3_000): Promise<boolean> {
    return Boolean(await this.findFirstVisible(this.authSurfaceLocators(), timeout));
  }

  async hasAuthenticatedSurface(timeout = 3_000): Promise<boolean> {
    return Boolean(await this.findFirstVisible(this.authenticatedSurfaceLocators(), timeout));
  }

  async hasPublicEntrySurface(timeout = 3_000): Promise<boolean> {
    return Boolean(await this.findFirstVisible(this.publicEntryLocators(), timeout));
  }

  async expectStableProfileSurface() {
    await this.expectNoGenericShell();
    await expect(this.page.getByText(INSSA_PROFILE_SURFACE_PATTERN).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async expectPointsLedgerSurface() {
    await this.expectNoGenericShell();
    await expect(this.page.getByText(INSSA_POINTS_LEDGER_PATTERN).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async expectSettingsSurface() {
    await this.expectNoGenericShell();
    await expect(this.page.getByText(INSSA_SETTINGS_PATTERN).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async expectConnectionsSurface() {
    await this.expectNoGenericShell();
    await expect(this.page.getByText(INSSA_CONNECTIONS_PATTERN).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async expectRequestsSurface() {
    await this.expectNoGenericShell();
    await expect(this.page.getByText(INSSA_REQUESTS_PATTERN).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  private async gotoPath(
    path: string,
    options: {
      allowHttpError?: boolean;
    } = {}
  ): Promise<boolean> {
    assertValidInssaUrl();

    try {
      const response = await this.page.goto(path, { waitUntil: "domcontentloaded" });
      if (response && response.status() >= 400) {
        if (options.allowHttpError) {
          return false;
        }

        throw new Error(`returned HTTP ${response.status()} for path "${path}"`);
      }

      await expectPageReady(this.page);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to load INSSA path "${path}": ${message}`);
    }
  }

  private authSurfaceLocators(): Locator[] {
    return [
      this.page.locator(
        [
          "form input:not([type='hidden'])",
          "input[type='email']",
          "input[type='password']",
          "input[autocomplete='email']",
          "input[autocomplete='username']",
          "input[autocomplete='current-password']"
        ].join(", ")
      ),
      this.page.getByRole("button", { name: AUTH_SIGNAL_PATTERN }),
      this.page.getByRole("link", { name: AUTH_SIGNAL_PATTERN }),
      this.page.locator("form button, form a[href]")
    ];
  }

  private authenticatedSurfaceLocators(): Locator[] {
    return [
      this.page.getByRole("button", { name: AUTHENTICATED_SIGNAL_PATTERN }),
      this.page.getByRole("link", { name: AUTHENTICATED_SIGNAL_PATTERN }),
      this.page.locator("a[href='/me'], a[href^='/u/'], a[href*='/profile']")
    ];
  }

  private publicEntryLocators(): Locator[] {
    return [
      this.page.getByRole("link", { name: PRIMARY_CTA_PATTERN }),
      this.page.getByRole("button", { name: PRIMARY_CTA_PATTERN }),
      this.page.getByRole("link", { name: AUTH_SIGNAL_PATTERN }),
      this.page.getByRole("button", { name: AUTH_SIGNAL_PATTERN }),
      this.getPrimaryCTAs()
    ];
  }

  private async findFirstVisible(
    locators: Locator[],
    timeout = DEFAULT_TIMEOUT
  ): Promise<Locator | null> {
    const deadline = Date.now() + timeout;

    while (Date.now() <= deadline) {
      for (const locator of locators) {
        const total = await locator.count();
        for (let index = 0; index < total; index += 1) {
          const candidate = locator.nth(index);
          if (await candidate.isVisible().catch(() => false)) {
            return candidate;
          }
        }
      }

      await this.page.waitForTimeout(200);
    }

    return null;
  }
}
