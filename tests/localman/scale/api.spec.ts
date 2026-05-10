import { expectPageNotBlank, expectVisiblePageUi, createCriticalPageMonitor } from "../../../utils/assertions";
import { LocalManPage } from "../../../pages/localman/localman-page";
import {
  createLocalManScaleDataset,
  expectLocalManScaleUiResponsive,
  expectNoDuplicateVisibleVendorCards,
  generate5kVendorDataset,
  getLocalManFilterButton,
  getLocalManSearchInput,
  getVisibleVendorNames,
  installLocalManScaleMocks,
  LOCALMAN_SCALE_GEOLOCATION,
  logLocalManScaleMetric,
  submitLocalManSearch
} from "../../../utils/localman-scale";
import { createApiLatencyMonitor } from "../../../utils/network";
import { expect, test } from "../fixtures";

test.describe("Local Man scale API churn", () => {
  test.describe.configure({ mode: "serial" });
  test.use({
    geolocation: LOCALMAN_SCALE_GEOLOCATION,
    permissions: ["geolocation"]
  });
  test.beforeEach(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
  });

  test("repeated nearby refreshes replace stale vendor state", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const apiMonitor = createApiLatencyMonitor(page, {
      endpointPattern: /\/api\/vendors\/nearby/i
    });
    const mockState = await installLocalManScaleMocks(page, {
      vendors: ({ requestNumber }) =>
        createLocalManScaleDataset(1_000, {
          versionTag: `R${String(requestNumber).padStart(2, "0")}`
        })
    });

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectVendorCardsVisible();
    await expectLocalManScaleUiResponsive(
      page,
      localman,
      "Expected Local Man discovery to remain interactive during nearby refresh churn."
    );

    let previousVersionTag = "";
    let observedNearbyRequestCount = mockState.nearbyRequests.length;
    const requestQueries = ["00002", "00004", "00006"];

    for (const [refresh, query] of requestQueries.entries()) {
      await submitLocalManSearch(page, query);

      await expect
        .poll(() => mockState.nearbyRequests.length, {
          message: `Expected Local Man to issue a fresh nearby request during request cycle ${refresh + 1}.`,
          timeout: 10_000
        })
        .toBeGreaterThan(observedNearbyRequestCount);

      observedNearbyRequestCount = mockState.nearbyRequests.length;

      const latestRequest = mockState.nearbyRequests.at(-1);
      expect(latestRequest, "Expected Local Man to issue a nearby request during repeated refresh scale QA.").toBeDefined();

      const expectedVersionTag = `R${String(latestRequest!.requestNumber).padStart(2, "0")}`;
      await localman.expectVendorCardsVisible();
      await expectLocalManScaleUiResponsive(
        page,
        localman,
        `Expected Local Man discovery to remain interactive during nearby request cycle ${refresh + 1}.`
      );
      const visibleNames = await getVisibleVendorNames(page, 6);
      expect(
        visibleNames.length,
        `Expected Local Man to render visible vendor names for nearby request cycle ${refresh + 1}.`
      ).toBeGreaterThan(0);

      for (const name of visibleNames) {
        expect(
          name,
          `Expected Local Man to avoid stale vendor state during nearby request cycle ${refresh + 1}. Visible name "${name}" does not contain version tag "${expectedVersionTag}".`
        ).toContain(expectedVersionTag);
        expect(
          name,
          `Expected Local Man nearby request cycle ${refresh + 1} to settle on search query "${query}". Visible name "${name}" does not contain that query.`
        ).toContain(query);
      }

      if (previousVersionTag) {
        const joinedNames = visibleNames.join(" | ");
        expect(
          joinedNames.includes(previousVersionTag),
          `Expected Local Man to replace stale nearby data. Previous version "${previousVersionTag}" was still visible after request cycle ${refresh + 1}.`
        ).toBeFalsy();
      }

      previousVersionTag = expectedVersionTag;
      await expectNoDuplicateVisibleVendorCards(page, 6);
    }

    logLocalManScaleMetric({
      kind: "nearby-refresh",
      nearbyRequestCount: mockState.nearbyRequests.length,
      route: page.url(),
      versionTag: previousVersionTag
    });

    await apiMonitor.waitForApiActivity({ minimum: 1 });
    apiMonitor.expectNoApiLatencyFailures({ minimum: 1 });
    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });

  test("delayed nearby responses keep the discovery shell usable under low-network conditions", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const apiMonitor = createApiLatencyMonitor(page, {
      endpointPattern: /\/api\/(?:vendors\/nearby|location\/reverse)/i,
      thresholdMs: 4_000
    });
    const mockState = await installLocalManScaleMocks(page, {
      nearbyDelayMs: 1_800,
      reverseDelayMs: 900,
      vendors: generate5kVendorDataset()
    });

    await localman.gotoPublicDiscovery();

    await expect
      .poll(() => mockState.getInFlightNearbyRequestCount() > 0, {
        message: "Expected the mocked nearby request to remain in flight long enough to validate low-network UI responsiveness.",
        timeout: 5_000
      })
      .toBe(true);

    await expectPageNotBlank(page);
    await expectVisiblePageUi(
      page,
      "Expected Local Man to keep a visible discovery shell while nearby data is delayed."
    );
    await expect(await getLocalManSearchInput(page)).toBeVisible();
    await expect(await getLocalManFilterButton(page)).toBeVisible();

    await expect
      .poll(() => mockState.nearbyRequests.length, {
        message: "Expected the delayed nearby request to finish and populate the mocked dataset.",
        timeout: 10_000
      })
      .toBeGreaterThan(0);

    await page.getByRole("region", { name: /vendor map/i }).scrollIntoViewIfNeeded().catch(() => undefined);
    await localman.expectMapOrFallback();
    await localman.expectVendorCardsVisible();
    await expectLocalManScaleUiResponsive(
      page,
      localman,
      "Expected Local Man discovery to remain usable after delayed nearby responses complete."
    );

    const firstNearbyRequest = mockState.nearbyRequests[0];
    logLocalManScaleMetric({
      durationMs: firstNearbyRequest?.durationMs ?? 0,
      kind: "low-network",
      nearbyRequestCount: mockState.nearbyRequests.length,
      route: page.url(),
      status:
        (firstNearbyRequest?.durationMs ?? 0) > 10_000
          ? "fail"
          : (firstNearbyRequest?.durationMs ?? 0) > 5_000
            ? "slow"
            : "pass"
    });

    await apiMonitor.waitForApiActivity({ minimum: 2 });
    apiMonitor.expectNoApiLatencyFailures({ minimum: 2 });
    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });
});
