import { test } from "./fixtures";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { DEFAULT_INSSA_US_MARKET_LOCATION_KEY, getInssaUsMarketLocation } from "../../utils/inssa-test-data";
import { withInssaStabilityMonitor } from "../../utils/monitor";

test.describe("INSSA media step capability audit", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);
  test.skip(
    !hasInssaTestCredentials(),
    "INSSA_TEST_EMAIL and INSSA_TEST_PASSWORD are required for the authenticated media-step audit."
  );

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  test("captures visible media options without uploading", async ({ page }, testInfo) => {
    const location = getInssaUsMarketLocation(DEFAULT_INSSA_US_MARKET_LOCATION_KEY);
    if (!location) {
      throw new Error(`Missing default INSSA USA market location "${DEFAULT_INSSA_US_MARKET_LOCATION_KEY}".`);
    }

    const compose = new TimeCapsulePage(page);
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open compose route for media audit", () => compose.goToComposeLocation(location), {
        phase: "navigation",
        route: "/timecapsule"
      });

      await monitor.step("assert compose surface before media audit", async () => {
        await compose.expectComposeSurface();
        await compose.expectRequiredFieldMetadata();
      }, { phase: "assertion" });

      await monitor.step("navigate to Media without uploading", async () => {
        await compose.advanceToMediaStep();
        await compose.expectMediaStep();
      }, { phase: "interaction" });

      await monitor.step("capture visible media capabilities", async () => {
        const mediaCapabilities = await compose.inspectMediaStepCapabilities();
        await testInfo.attach("inssa-media-capabilities.json", {
          body: JSON.stringify(
            {
              location,
              mediaCapabilities
            },
            null,
            2
          ),
          contentType: "application/json"
        });
      }, { phase: "assertion" });

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});

function hasInssaTestCredentials() {
  return Boolean(process.env.INSSA_TEST_EMAIL?.trim() && process.env.INSSA_TEST_PASSWORD?.trim());
}
