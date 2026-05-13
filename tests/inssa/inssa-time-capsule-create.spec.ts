import { expect, test as baseTest } from "@playwright/test";
import { LandingPage } from "../../pages/inssa/landing.page";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import {
  INSSA_TIME_CAPSULE_NEXT_PATTERN,
  INSSA_TIME_CAPSULE_ROUTE_PATTERN
} from "../../utils/inssa-test-data";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { test as authenticatedTest } from "./fixtures";

baseTest.describe("INSSA time capsule compose entry", () => {
  baseTest.beforeAll(() => {
    assertValidInssaUrl();
  });

  baseTest("logged-out bury redirects to sign-in with a timecapsule next param", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open INSSA landing page", () => landing.goToHome(), { phase: "navigation", route: "/" });
      await monitor.step("assert public landing surface", () => landing.expectPublicLandingSurface(), {
        phase: "assertion"
      });
      await monitor.step("open Bury while logged out", () => landing.openBuryEntry(), { phase: "interaction" });
      await monitor.step("assert logged-out compose entry redirects to sign-in", async () => {
        await expect
          .poll(() => page.url(), {
            message: "Expected logged-out Bury to redirect to the sign-in route.",
            timeout: 15_000
          })
          .toMatch(/\/signin/i);
        await expect(page.url()).toMatch(INSSA_TIME_CAPSULE_NEXT_PATTERN);
      }, { phase: "assertion" });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});

authenticatedTest.describe("INSSA time capsule compose entry", () => {
  authenticatedTest.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  authenticatedTest("authenticated bury opens the compose surface", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);
    const timeCapsule = new TimeCapsulePage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
        phase: "navigation",
        route: "/"
      });
      await monitor.step("assert authenticated landing surface", () => landing.expectAuthenticatedLandingSurface(), {
        phase: "assertion"
      });
      await monitor.step("open authenticated Bury entry", () => landing.openBuryEntry(), { phase: "interaction" });
      await monitor.step("assert time capsule compose surface", () => timeCapsule.expectComposeSurface(), {
        phase: "assertion",
        route: "/timecapsule"
      });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  authenticatedTest("compose surface exposes safe required-field metadata", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);
    const timeCapsule = new TimeCapsulePage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
        phase: "navigation",
        route: "/"
      });
      await monitor.step("open authenticated Bury entry", () => landing.openBuryEntry(), { phase: "interaction" });
      await monitor.step("assert compose route is active", async () => {
        await expect
          .poll(() => page.url(), {
            message: "Expected authenticated Bury to open the compose route.",
            timeout: 15_000
          })
          .toMatch(INSSA_TIME_CAPSULE_ROUTE_PATTERN);
      }, { phase: "assertion" });
      await monitor.step("assert required-field metadata and limits", () => timeCapsule.expectRequiredFieldMetadata(), {
        phase: "assertion"
      });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});
