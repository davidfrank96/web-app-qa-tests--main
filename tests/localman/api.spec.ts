import { test } from "./fixtures";
import { LocalManPage } from "../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../utils/assertions";
import { createLocalManVendorApiMonitor } from "../../utils/localman-api";

const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};

test.describe("Local Man vendor API behavior", () => {
  test.use({
    geolocation: VALID_GEOLOCATION,
    permissions: ["geolocation"]
  });

  test("nearby vendor api responds with valid schema and matches the discovery UI", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const apiMonitor = createLocalManVendorApiMonitor(page, {
      label: testInfo.title
    });

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await apiMonitor.waitForVendorResponses();

    const state = await localman.detectDiscoveryState();
    await localman.expectVendorCardsOrValidEmptyState(state);

    await apiMonitor.expectHealthyVendorResponses({ state, requireNearbyEndpoint: true });
    await monitor.expectNoCriticalIssues();
  });
});
