import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../../utils/assertions";
import {
  expectLocalManScaleUiResponsive,
  generate5kVendorDataset,
  getVendorNameForPreviewButton,
  getVisibleVendorPreviewButtons,
  installLocalManScaleMocks,
  LOCALMAN_SCALE_GEOLOCATION,
  logLocalManScaleMetric
} from "../../../utils/localman-scale";
import { createApiLatencyMonitor } from "../../../utils/network";
import { expect, test } from "../fixtures";

test.describe("Local Man scale map churn", () => {
  test.describe.configure({ mode: "serial" });
  test.use({
    geolocation: LOCALMAN_SCALE_GEOLOCATION,
    permissions: ["geolocation"]
  });
  test.beforeEach(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
  });

  test("repeated map preview interactions keep the selected vendor state current", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const apiMonitor = createApiLatencyMonitor(page, {
      endpointPattern: /\/api\/vendors\/nearby/i
    });

    await installLocalManScaleMocks(page, {
      vendors: generate5kVendorDataset()
    });

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await expectLocalManScaleUiResponsive(
      page,
      localman,
      "Expected Local Man discovery to remain interactive during repeated map interactions."
    );
    await localman.expectVendorCardsVisible();

    const mapRegion = page.getByRole("region", { name: /vendor map/i });
    await mapRegion.scrollIntoViewIfNeeded().catch(() => undefined);
    await localman.expectMapOrFallback();

    const previewButtons = await getVisibleVendorPreviewButtons(page, 6);
    expect(
      previewButtons.length,
      "Expected Local Man to render visible preview buttons for repeated map-interaction scale QA."
    ).toBeGreaterThanOrEqual(4);

    let lastVendorName = "";

    for (const button of previewButtons) {
      lastVendorName = await getVendorNameForPreviewButton(button);
      await button.click();

      const mapBounds = await mapRegion.boundingBox();
      if (mapBounds) {
        await page.mouse.move(mapBounds.x + mapBounds.width / 2, mapBounds.y + mapBounds.height / 2);
        await page.mouse.wheel(0, 350);
        await page.mouse.wheel(0, -250);
      }
    }

    expect(lastVendorName, "Expected the final repeated map interaction to resolve a non-empty vendor name.").not.toBe("");

    await expect
      .poll(async () => {
        const headingVisible = await page
          .getByRole("heading", { name: new RegExp(escapeRegExp(lastVendorName), "i") })
          .isVisible()
          .catch(() => false);
        const hasVendorActions =
          (await page.getByRole("link", { name: /call|directions/i }).count()) > 0 ||
          (await page.getByRole("button", { name: /call|directions/i }).count()) > 0;
        const noVendorSelectedVisible = await page.getByText(/no vendor selected/i).isVisible().catch(() => false);

        return headingVisible && hasVendorActions && !noVendorSelectedVisible;
      }, {
        message: "Expected Local Man to keep vendor detail actions visible after repeated map preview interactions.",
        timeout: 10_000
      })
      .toBe(true);

    await expectLocalManScaleUiResponsive(
      page,
      localman,
      "Expected Local Man discovery to remain interactive after repeated map interactions."
    );

    logLocalManScaleMetric({
      kind: "map-churn",
      previewInteractionCount: previewButtons.length,
      route: page.url(),
      selectedVendorName: lastVendorName
    });

    await apiMonitor.waitForApiActivity({ minimum: 1 });
    apiMonitor.expectNoApiLatencyFailures({ minimum: 1 });
    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
