import { LocalManPage } from "../../pages/localman/localman-page";
import { expectPageNotBlank, expectVisiblePageUi } from "../../utils/assertions";
import {
  assertNavigationThresholds,
  createApiPerfMonitor,
  measureCurrentNavigation,
  summarizeRepeatedVisits,
  type RepeatedVisitSample
} from "../../utils/perf";
import { expect, test } from "./fixtures";

const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};
const REPEATED_VISIT_COUNT = 4;

test.describe("Local Man performance", () => {
  test.describe.configure({ mode: "serial" });
  test.use({
    geolocation: VALID_GEOLOCATION,
    permissions: ["geolocation"]
  });

  test("homepage route stays within load thresholds", async ({ page }) => {
    const localman = new LocalManPage(page);

    await localman.gotoHome();
    await localman.expectHomePageLoad();
    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, "Expected the Local Man homepage to expose visible UI during performance measurement.");

    const metrics = await measureCurrentNavigation(page, "/");
    assertNavigationThresholds(metrics);

    await expect(page).toHaveURL(/\/?(?:\?.*)?$/);
  });

  test("public discovery route and nearby APIs stay within thresholds", async ({ page }) => {
    const localman = new LocalManPage(page);
    const apiMonitor = createApiPerfMonitor(page);

    const route = await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    const discoveryState = await localman.detectDiscoveryState();
    await localman.expectVendorCardsOrValidEmptyState(discoveryState);
    await expectPageNotBlank(page);
    await expectVisiblePageUi(
      page,
      "Expected the Local Man discovery route to expose visible UI during performance measurement."
    );

    const metrics = await measureCurrentNavigation(page, route);
    assertNavigationThresholds(metrics);

    await apiMonitor.waitForCompletedCalls({ minimum: 1 });
    apiMonitor.assertWithinThresholds({ minimum: 1 });
  });

  test("repeated discovery visits stay usable under lightweight load simulation", async ({ page }) => {
    const localman = new LocalManPage(page);
    const samples: RepeatedVisitSample[] = [];

    const route = await localman.gotoPublicDiscovery();

    for (let visit = 1; visit <= REPEATED_VISIT_COUNT; visit += 1) {
      if (visit > 1) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
      }

      await localman.expectPublicDiscoverySurface();
      await localman.expectMapOrFallback();
      const discoveryState = await localman.detectDiscoveryState();
      await localman.expectVendorCardsOrValidEmptyState(discoveryState);
      await expectPageNotBlank(page);
      await expectVisiblePageUi(
        page,
        `Expected the Local Man discovery route to stay usable during repeated visit ${visit}.`
      );

      const metrics = await measureCurrentNavigation(page, route);
      assertNavigationThresholds(metrics);

      const totalLoadMetric = metrics.find((metric) => metric.metric === "total-load");
      expect(
        totalLoadMetric,
        `Expected a total-load metric for Local Man repeated visit ${visit}.`
      ).toBeDefined();

      samples.push({
        route,
        totalLoadMs: totalLoadMetric!.durationMs,
        visit
      });
    }

    summarizeRepeatedVisits(route, samples);
  });
});
