import { dismissInssaSessionWarning } from "../../utils/inssa-session-warning";
import { expect, test as authenticatedTest } from "./fixtures";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { INSSA_TIME_CAPSULE_ROUTE_PATTERN } from "../../utils/inssa-test-data";
import { withInssaStabilityMonitor } from "../../utils/monitor";

// Home/Bury (including logged-out entry) is owned by governed Text Lifecycle:
// Home automatically invokes a backend that creates system-owned discover capsules.
authenticatedTest.use({ productWriteAuditEnabled: true, safeSession: true });
authenticatedTest.describe("INSSA direct compose safe coverage", () => {
  authenticatedTest.skip(!process.env.INSSA_TEST_EMAIL?.trim() || !process.env.INSSA_TEST_PASSWORD?.trim(), "INSSA staging credentials required");
  authenticatedTest.beforeAll(() => { assertValidInssaUrl(); getInssaTestCredentials(); });
  authenticatedTest("authenticated direct compose route renders the non-destructive compose surface", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);
    const timeCapsule = new TimeCapsulePage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated compose route directly", () => timeCapsule.goToComposeRoute(), {
        phase: "navigation",
        route: "/timecapsule"
      });
      await monitor.step("assert compose route is active", async () => {
        await expect
          .poll(() => page.url(), {
            message: "Expected direct authenticated compose navigation to stay on the compose route.",
            timeout: 15_000
          })
          .toMatch(INSSA_TIME_CAPSULE_ROUTE_PATTERN);
      }, { phase: "assertion" });
      await monitor.step("assert compose surface and required-field metadata", async () => {
        await timeCapsule.expectComposeSurface();
        await dismissInssaSessionWarning(page);
        await timeCapsule.expectRequiredFieldMetadata();
      }, { phase: "assertion" });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});
