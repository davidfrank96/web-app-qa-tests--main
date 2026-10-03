import { expectInssaLocationDefaults } from "../../utils/inssa-compose-contract";
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

test.use({ productWriteAuditEnabled: true });

test.describe("INSSA USA compose location matrix", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);
  test.skip(
    !hasInssaTestCredentials(),
    "INSSA_TEST_EMAIL and INSSA_TEST_PASSWORD are required for authenticated location-matrix checks."
  );

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
          expectInssaLocationDefaults(values, templateDefaults.subject);
          const actualRoute = new URL(page.url());
          const expectedRoute = new URL(route, actualRoute.origin);
          for (const key of ["address", "place", "lat", "lng", "placeId"]) {
            expect(actualRoute.searchParams.get(key), `Selected location parameter ${key}`).toBe(expectedRoute.searchParams.get(key));
          }
          await testInfo.attach(`us-location-${location.key}-defaults.json`, {
            body: JSON.stringify({ location, route, values, limits: { subject: 140, message: 3000 } }, null, 2),
            contentType: "application/json"
          });
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

function hasInssaTestCredentials() {
  return Boolean(process.env.INSSA_TEST_EMAIL?.trim() && process.env.INSSA_TEST_PASSWORD?.trim());
}
