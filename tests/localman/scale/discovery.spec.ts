import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../../utils/assertions";
import {
  expectLocalManScaleUiResponsive,
  expectNoDuplicateVisibleVendorCards,
  generate10kVendorDataset,
  generate1kVendorDataset,
  generate20kVendorDataset,
  generate5kVendorDataset,
  getVisibleVendorCards,
  getVisibleVendorNames,
  installLocalManScaleMocks,
  LOCALMAN_SCALE_GEOLOCATION,
  logLocalManScaleMetric,
  submitLocalManSearch
} from "../../../utils/localman-scale";
import { createApiLatencyMonitor } from "../../../utils/network";
import { expect, test } from "../fixtures";

const DATASET_CASES = [
  { count: 1_000, label: "1k", mode: "surface", vendors: generate1kVendorDataset },
  { count: 5_000, label: "5k", mode: "surface", vendors: generate5kVendorDataset },
  { count: 10_000, label: "10k", mode: "shell", vendors: generate10kVendorDataset },
  { count: 20_000, label: "20k", mode: "shell", vendors: generate20kVendorDataset }
] as const;
const DATASET_RENDER_SAMPLE_SIZE = 4;

test.describe("Local Man scale discovery", () => {
  test.describe.configure({ mode: "serial" });
  test.use({
    geolocation: LOCALMAN_SCALE_GEOLOCATION,
    permissions: ["geolocation"]
  });
  test.beforeEach(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
  });

  for (const datasetCase of DATASET_CASES) {
    test(`discovery remains usable with ${datasetCase.label} mocked vendors`, async ({ page }) => {
      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);
      const apiMonitor = createApiLatencyMonitor(page, {
        endpointPattern: /\/api\/(?:vendors\/nearby|location\/reverse)/i
      });

      await installLocalManScaleMocks(page, {
        vendors: datasetCase.vendors()
      });

      const startedAt = Date.now();
      const route = await localman.gotoPublicDiscovery();
      await localman.expectPublicDiscoverySurface();
      await expectLocalManScaleUiResponsive(
        page,
        localman,
        `Expected Local Man discovery to remain usable with ${datasetCase.label} mocked vendors.`
      );
      let visibleVendorCount = 0;

      if (datasetCase.mode === "surface") {
        await localman.expectVendorCardsVisible();

        const visibleCards = await getVisibleVendorCards(page, DATASET_RENDER_SAMPLE_SIZE);
        expect(
          visibleCards.length,
          `Expected Local Man to expose visible vendor surfaces for the ${datasetCase.label} scale dataset.`
        ).toBeGreaterThan(0);
        visibleVendorCount = visibleCards.length;
      }

      const totalDurationMs = Date.now() - startedAt;

      logLocalManScaleMetric({
        datasetCount: datasetCase.count,
        durationMs: totalDurationMs,
        kind: "dataset-render",
        mode: datasetCase.mode,
        route,
        status: totalDurationMs > 10_000 ? "slow" : "pass",
        visibleVendorCount
      });

      await apiMonitor.waitForApiActivity({ minimum: 1 });
      apiMonitor.expectNoApiLatencyFailures({ minimum: 1 });
      await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
    });
  }

  test("rapid search churn keeps the final vendor result set fresh", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const apiMonitor = createApiLatencyMonitor(page, {
      endpointPattern: /\/api\/vendors\/nearby/i
    });
    const dataset = generate10kVendorDataset();
    const mockState = await installLocalManScaleMocks(page, { vendors: dataset });
    const queries = ["00017", "01234", "09876", "04999"];
    const finalQuery = queries.at(-1)!;

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await expectLocalManScaleUiResponsive(
      page,
      localman,
      "Expected Local Man discovery to stay interactive while search queries churn rapidly."
    );
    await localman.expectVendorCardsVisible();

    for (const query of queries) {
      await submitLocalManSearch(page, query);
    }

    await expect
      .poll(() => mockState.nearbyRequests.at(-1)?.query ?? "", {
        message: "Expected the final nearby-search request to reflect the last rapid search query.",
        timeout: 10_000
      })
      .toContain(finalQuery);

    await expect
      .poll(async () => (await getVisibleVendorNames(page, 6)).join(" | "), {
        message: "Expected the visible vendor result set to settle on the final rapid search query.",
        timeout: 10_000
      })
      .toContain(finalQuery);

    const visibleNames = await getVisibleVendorNames(page, 6);
    expect(visibleNames.length, "Expected at least one visible vendor after rapid search churn.").toBeGreaterThan(0);

    for (const name of visibleNames) {
      expect(
        name,
        `Expected Local Man to avoid stale vendor state after search churn. Visible name "${name}" does not match the final query "${finalQuery}".`
      ).toContain(finalQuery);
    }

    await expectNoDuplicateVisibleVendorCards(page, 6);

    logLocalManScaleMetric({
      finalQuery,
      kind: "search-churn",
      nearbyRequestCount: mockState.nearbyRequests.length,
      route: page.url(),
      visibleVendorCount: visibleNames.length
    });

    await apiMonitor.waitForApiActivity({ minimum: 1 });
    apiMonitor.expectNoApiLatencyFailures({ minimum: 1 });
    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });
});
