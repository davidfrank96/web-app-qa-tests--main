import { test } from "@playwright/test";
import { InssaPage } from "../../pages/inssa/inssa-page";
import { createInssaErrorMonitor } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { withInssaStabilityMonitor } from "../../utils/monitor";

test.describe("INSSA smoke checks", () => {
  test.beforeAll(() => {
    assertValidInssaUrl();
  });

  test("landing page loads and exposes a primary CTA", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page, { defaultIgnorePatterns: [] });
    const inssa = new InssaPage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open INSSA landing page", () => inssa.goToHome(), { phase: "navigation", route: "/" });
      await monitor.step("assert landing page is healthy", () => inssa.expectHealthyPage(), { phase: "assertion" });
      await monitor.step("assert landing CTA is visible", () => inssa.expectLandingCTAVisible(), { phase: "assertion" });
      await monitor.step("assert landing page has an actionable control", () => inssa.expectAnyActionableButton(), {
        phase: "assertion"
      });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("sign-in or onboarding route loads and shows auth controls", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page, { defaultIgnorePatterns: [] });
    const inssa = new InssaPage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open INSSA sign-in or onboarding route", () => inssa.goToSignIn(), {
        phase: "navigation",
        route: "/sign-in"
      });
      await monitor.step("assert auth page is healthy", () => inssa.expectHealthyPage(), { phase: "assertion" });
      await monitor.step("assert auth controls are visible", () => inssa.expectAuthSurface(), { phase: "assertion" });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("navigation surface renders with an actionable control", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page, { defaultIgnorePatterns: [] });
    const inssa = new InssaPage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open INSSA landing page", () => inssa.goToHome(), { phase: "navigation", route: "/" });
      await monitor.step("assert navigation page is healthy", () => inssa.expectHealthyPage(), {
        phase: "assertion"
      });
      await monitor.step("assert navigation actions are visible", () => inssa.expectNavigationSurface(), {
        phase: "assertion"
      });
      await monitor.step("assert page has at least one actionable control", () => inssa.expectAnyActionableButton(), {
        phase: "assertion"
      });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});
