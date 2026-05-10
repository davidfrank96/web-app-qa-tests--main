import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../../utils/assertions";
import {
  expectLocalManScaleUiResponsive,
  expectNoDuplicateVisibleVendorCards,
  generate10kVendorDataset,
  getLocalManFilterButton,
  getVisibleVendorNames,
  installLocalManScaleMocks,
  LOCALMAN_SCALE_GEOLOCATION,
  logLocalManScaleMetric,
  submitLocalManSearch
} from "../../../utils/localman-scale";
import { createApiLatencyMonitor } from "../../../utils/network";
import { expect, test } from "../fixtures";

const FILTER_TOGGLE_CYCLES = 12;
const PINNED_QUERY = "00042";

test.describe("Local Man scale UI churn", () => {
  test.describe.configure({ mode: "serial" });
  test.use({
    geolocation: LOCALMAN_SCALE_GEOLOCATION,
    permissions: ["geolocation"]
  });
  test.beforeEach(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
  });

  test("rapid filter toggling preserves interactive discovery UI and current results", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const apiMonitor = createApiLatencyMonitor(page, {
      endpointPattern: /\/api\/vendors\/nearby/i
    });

    await installLocalManScaleMocks(page, {
      vendors: generate10kVendorDataset()
    });

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await expectLocalManScaleUiResponsive(
      page,
      localman,
      "Expected Local Man discovery to remain interactive during rapid filter churn."
    );

    await submitLocalManSearch(page, PINNED_QUERY);
    await expect
      .poll(async () => (await getVisibleVendorNames(page, 6)).join(" | "), {
        message: "Expected Local Man to settle on the pinned search result before filter churn begins.",
        timeout: 10_000
      })
      .toContain(PINNED_QUERY);

    for (let cycle = 0; cycle < FILTER_TOGGLE_CYCLES; cycle += 1) {
      const filterButton = await getLocalManFilterButton(page);
      await filterButton.click();
      await expect(await getLocalManFilterButton(page)).toBeVisible();
    }

    await expectLocalManScaleUiResponsive(
      page,
      localman,
      "Expected Local Man discovery to remain interactive after rapid filter churn."
    );

    const visibleNames = await getVisibleVendorNames(page, 6);
    expect(visibleNames.length, "Expected Local Man to keep showing pinned vendor results after filter churn.").toBeGreaterThan(0);

    for (const name of visibleNames) {
      expect(
        name,
        `Expected Local Man filter churn not to leave stale vendor state. Visible name "${name}" does not match the pinned query "${PINNED_QUERY}".`
      ).toContain(PINNED_QUERY);
    }

    await expectNoDuplicateVisibleVendorCards(page, 6);

    logLocalManScaleMetric({
      filterToggleCycles: FILTER_TOGGLE_CYCLES,
      kind: "filter-churn",
      nearbyRequestCount: apiMonitor.entries.length,
      route: page.url(),
      visibleVendorCount: visibleNames.length
    });

    await apiMonitor.waitForApiActivity({ minimum: 1 });
    apiMonitor.expectNoApiLatencyFailures({ minimum: 1 });
    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });
});
