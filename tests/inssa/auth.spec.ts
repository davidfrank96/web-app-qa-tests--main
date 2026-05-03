import { test as baseTest } from "@playwright/test";
import { AuthPage } from "../../pages/inssa/auth-page";
import { createInssaErrorMonitor, getInssaTestCredentials, login, logout } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { test as authenticatedTest } from "./fixtures";

baseTest.describe("INSSA auth checks", () => {
  baseTest.describe.configure({ mode: "default" });

  baseTest.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  baseTest("login flow succeeds and exposes authenticated UI", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      const authPage = await monitor.step("login with valid credentials", () => login(page), { phase: "navigation" });
      await monitor.step("open authenticated profile", () => authPage.goToProfile(), { phase: "navigation" });
      await monitor.step("assert authenticated profile surface", () => authPage.expectProfileSurface(), {
        phase: "assertion"
      });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  baseTest("invalid login shows an error message", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);
    const { email } = getInssaTestCredentials();
    const authPage = new AuthPage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open sign-in route", () => authPage.goToSignIn(), { phase: "navigation" });
      await monitor.step("submit invalid email/password credentials", () =>
        authPage.submitEmailPassword(email, "wrong-password-123")
      );
      await monitor.step("assert invalid login feedback", () => authPage.expectInvalidLoginError(), {
        phase: "assertion"
      });
      await monitor.step(
        "assert no unexpected INSSA errors",
        () =>
          errorMonitor.expectNoUnexpectedErrors([
            /wrong-password/i,
            /Failed to load resource: the server responded with a status of 400/i,
            /Error signing in with email and password/i
          ]),
        { phase: "assertion" }
      );
    });
  });

});

authenticatedTest.describe("INSSA auth checks", () => {
  authenticatedTest.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  authenticatedTest("session persists across reload", async ({ page, authPage }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", () => authPage.goToProfile(), { phase: "navigation" });
      await monitor.step("reload authenticated profile", () => authPage.reloadAndExpectAuthenticated(), {
        phase: "navigation"
      });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  authenticatedTest("logout returns the user to a public state", async ({ page, authPage }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", async () => {
        await authPage.goToProfile();
        await authPage.expectProfileSurface();
      }, {
        phase: "navigation"
      });
      await monitor.step("logout from authenticated session", () => logout(page), { phase: "navigation" });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});
