import { expect, test } from "./fixtures";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import {
  buildInssaComposeRouteForLocation,
  getInssaComposeTemplateDefaults,
  INSSA_TIME_CAPSULE_ROUTE_PATTERN,
  INSSA_US_MARKET_LOCATIONS
} from "../../utils/inssa-test-data";
import { withInssaStabilityMonitor } from "../../utils/monitor";

test.describe("INSSA USA compose location matrix", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  for (const location of INSSA_US_MARKET_LOCATIONS) {
    test(`authenticated compose renders safely for ${location.label}`, async ({ page }, testInfo) => {
      const compose = new TimeCapsulePage(page);
      const errorMonitor = createInssaErrorMonitor(page);
      const route = buildInssaComposeRouteForLocation(location);
      const templateDefaults = getInssaComposeTemplateDefaults(route);

      await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
        await monitor.step("open compose route for USA market location", () => compose.goToComposeRoute(route), {
          phase: "navigation",
          route
        });

        await monitor.step("assert compose surface and seeded defaults", async () => {
          await compose.expectComposeSurface();
          await compose.expectRequiredFieldMetadata();
          await expect(page.url()).toMatch(INSSA_TIME_CAPSULE_ROUTE_PATTERN);

          const values = await compose.readComposeValues();
          expect(
            values.subject,
            `Expected the compose subject to seed from the selected USA location defaults for ${location.label}.`
          ).toBe(templateDefaults.subject);
          expect(
            values.message.toLowerCase(),
            `Expected the compose message to seed from the selected USA location template for ${location.label}.`
          ).toContain((location.place ?? location.label).toLowerCase());
        }, { phase: "assertion" });

        await monitor.step("reach Media safely without publishing", async () => {
          await compose.advanceToMediaStep();
          await compose.expectMediaStep();
        }, { phase: "interaction" });

        await monitor.step("reach Share safely without publishing", async () => {
          await compose.advanceToShareStep();
          await compose.expectShareStep();
          const inspection = await compose.inspectLiveCreateAction();

          await testInfo.attach(`us-location-${location.key}-share-step.json`, {
            body: JSON.stringify(
              {
                location,
                route,
                shareStepButtons: inspection.visibleButtons,
                shareStepCreateCandidates: inspection.candidateLabels
              },
              null,
              2
            ),
            contentType: "application/json"
          });
        }, { phase: "interaction" });

        await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
          phase: "assertion"
        });
      });
    });
  }
});
