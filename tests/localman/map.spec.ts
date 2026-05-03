import type { Locator, Page } from "@playwright/test";
import { LocalManPage } from "../../pages/localman/localman-page";
import { createCriticalPageMonitor, expectPageNotBlank, expectVisiblePageUi } from "../../utils/assertions";
import { expect, test } from "./fixtures";

const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};

const LOCATION_FALLBACK_PATTERN =
  /location (?:access )?denied|unable to access location|location unavailable|using default location|default location|enable location|turn on location|retry location|map view limited|vendors still available below|map unavailable|unable to load map|could not load map|list view only/i;

test.describe("Local Man geolocation and map behavior", () => {
  test.describe("location granted", () => {
    test.use({
      geolocation: VALID_GEOLOCATION,
      permissions: ["geolocation"]
    });

    test("granted location keeps map and discovery results usable", async ({ page }) => {
      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);

      await localman.gotoPublicDiscovery();
      await expectBaselineMapSurface(page, localman);
      await expectResolvedDiscoveryState(localman);
      await expectMarkersIfPresent(page);
      await monitor.expectNoCriticalIssues();
    });
  });

  test.describe("location denied", () => {
    test.use({
      permissions: []
    });

    test("denied location shows fallback UI and does not crash", async ({ page }) => {
      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);

      await localman.gotoPublicDiscovery();
      await expectBaselineMapSurface(page, localman);
      await expectLocationFallbackUi(page);
      await expectResolvedDiscoveryState(localman);
      await monitor.expectNoCriticalIssues();
    });
  });

  test.describe("location unavailable", () => {
    test.use({
      permissions: ["geolocation"]
    });

    test("unavailable location falls back to a usable default discovery state", async ({ page }) => {
      await page.addInitScript(() => {
        const makeError = () => ({
          code: 2,
          message: "Position unavailable",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3
        });

        Object.defineProperty(navigator, "geolocation", {
          configurable: true,
          value: {
            getCurrentPosition: (_success: unknown, error?: (positionError: ReturnType<typeof makeError>) => void) => {
              error?.(makeError());
            },
            watchPosition: (_success: unknown, error?: (positionError: ReturnType<typeof makeError>) => void) => {
              error?.(makeError());
              return 0;
            },
            clearWatch: () => undefined
          }
        });
      });

      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);

      await localman.gotoPublicDiscovery();
      await expectBaselineMapSurface(page, localman);
      await expectResolvedDiscoveryState(localman);
      await expectDefaultLocationSignal(page);
      await expectMarkersIfPresent(page);
      await monitor.expectNoCriticalIssues();
    });
  });
});

async function expectBaselineMapSurface(page: Page, localman: LocalManPage) {
  await localman.expectPublicDiscoverySurface();
  await localman.expectMapOrFallback();
  await expectPageNotBlank(page);
  await expectVisiblePageUi(page, "Expected Local Man to render visible map or discovery UI.");
}

async function expectResolvedDiscoveryState(localman: LocalManPage) {
  const state = await localman.detectDiscoveryState();
  await localman.expectVendorCardsOrValidEmptyState(state);
}

async function expectMarkersIfPresent(page: Page) {
  const mapContainer = page.getByRole("region", { name: /vendor map/i });
  if (!(await mapContainer.isVisible().catch(() => false))) {
    return;
  }

  const markerCandidates = [
    mapContainer.locator("[aria-label*='marker' i]"),
    mapContainer.locator("[aria-label*='vendor' i]"),
    mapContainer.getByRole("img", { name: /marker|vendor|location/i })
  ];

  for (const locator of markerCandidates) {
    const count = await locator.count();
    if (count === 0) {
      continue;
    }

    await expect(locator.first(), "Expected any rendered map marker indicator to be visible.").toBeVisible();
    return;
  }
}

async function expectLocationFallbackUi(page: Page) {
  const fallback = await firstVisible(
    [
      page.getByText(LOCATION_FALLBACK_PATTERN),
      page.getByRole("status").filter({ hasText: LOCATION_FALLBACK_PATTERN }),
      page.getByRole("alert").filter({ hasText: LOCATION_FALLBACK_PATTERN })
    ],
    5_000
  );

  expect(
    fallback,
    "Expected explicit fallback UI when geolocation permission is denied."
  ).not.toBeNull();
  await expect(fallback!).toBeVisible();
}

async function expectDefaultLocationSignal(page: Page) {
  const currentUrl = new URL(page.url());
  const locationSource = currentUrl.searchParams.get("location_source");
  if (locationSource) {
    expect(
      locationSource,
      "Expected the Local Man fallback flow to identify a default location source when geolocation is unavailable."
    ).toMatch(/default/i);
    return;
  }

  const locationInput = await firstVisible(
    [
      page.getByRole("searchbox", { name: /location|address|city|zip/i }),
      page.getByRole("textbox", { name: /location|address|city|zip/i })
    ],
    2_000
  );

  expect(
    locationInput,
    "Expected a usable default-location signal such as a populated location field or default location query parameter."
  ).not.toBeNull();

  const value = await locationInput!.inputValue().catch(() => "");
  expect(
    value.trim(),
    "Expected the Local Man discovery UI to resolve a non-empty default location after geolocation becomes unavailable."
  ).not.toBe("");
}

async function firstVisible(locators: Locator[], timeoutMs: number): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      if (count === 0) {
        continue;
      }

      const firstMatch = locator.first();
      if (await firstMatch.isVisible().catch(() => false)) {
        return firstMatch;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
}
