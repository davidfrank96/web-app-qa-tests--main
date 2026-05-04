import type { Locator, Page, Route } from "@playwright/test";
import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor, expectPageNotBlank, expectVisiblePageUi } from "../../../utils/assertions";
import { expect, test } from "../fixtures";

const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};
const SEARCH_TERMS = ["ta", "vendor", "3", "", "final"];
const FILTER_TOGGLE_COUNT = 6;

type NearbyPayload = {
  success: boolean;
  data: {
    location: {
      source: string;
      label: string;
      coordinates: {
        lat: number;
        lng: number;
      };
      isApproximate: boolean;
    };
    vendors: Array<Record<string, unknown>>;
  };
  error: unknown;
};

test.describe("Local Man light DoS safety", () => {
  test.use({
    geolocation: VALID_GEOLOCATION,
    permissions: ["geolocation"]
  });

  test("repeated search interactions keep the discovery UI responsive", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, 10);
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    const search = await getPrimarySearchInput(page);
    const startedAt = Date.now();

    for (const term of SEARCH_TERMS) {
      await search.fill(term);
      await triggerSearch(page, search);
      await waitForSearchSettle(page, localman);
      await expectUiResponsive(page, localman, `Expected Local Man to remain responsive after repeated search term "${term}".`);
      await expect(search).toHaveValue(term);
    }

    console.log(
      `LOCALMAN_LIGHT_DOS ${JSON.stringify({
        durationMs: Date.now() - startedAt,
        interactionCount: SEARCH_TERMS.length,
        kind: "search-burst",
        route: page.url(),
        test: testInfo.title,
        timestamp: new Date().toISOString()
      })}`
    );

    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });

  test("rapid filter toggling keeps the discovery UI responsive", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, 10);
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    const startedAt = Date.now();

    for (let cycle = 0; cycle < FILTER_TOGGLE_COUNT; cycle += 1) {
      const filterButton = await getFilterButton(page);
      await filterButton.click();
      await waitForPossibleRefresh(page);
      await expectUiResponsive(
        page,
        localman,
        `Expected Local Man to remain responsive after rapid filter toggle ${cycle + 1}.`
      );
    }

    console.log(
      `LOCALMAN_LIGHT_DOS ${JSON.stringify({
        durationMs: Date.now() - startedAt,
        interactionCount: FILTER_TOGGLE_COUNT,
        kind: "filter-toggle-burst",
        route: page.url(),
        test: testInfo.title,
        timestamp: new Date().toISOString()
      })}`
    );

    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });
});

async function mockNearbyPayload(page: Page, vendorCount: number) {
  await page.route("**/api/vendors/nearby**", async (route) => {
    const payload = await resolveNearbyPayload(route);
    await route.fulfill({
      body: JSON.stringify({
        ...payload,
        data: {
          ...payload.data,
          vendors: Array.from({ length: vendorCount }, (_, index) => createVendor(index + 1))
        }
      }),
      contentType: "application/json",
      status: 200
    });
  });
}

async function resolveNearbyPayload(route: Route): Promise<NearbyPayload> {
  try {
    const response = await route.fetch();
    const payload = (await response.json()) as unknown;
    if (isNearbyPayload(payload)) {
      return payload;
    }
  } catch {
    return createFallbackNearbyPayload();
  }

  return createFallbackNearbyPayload();
}

function isNearbyPayload(payload: unknown): payload is NearbyPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "success" in payload &&
    "data" in payload &&
    typeof (payload as NearbyPayload).success === "boolean"
  );
}

function createFallbackNearbyPayload(): NearbyPayload {
  return {
    success: true,
    data: {
      location: {
        source: "precise",
        label: "Current location",
        coordinates: {
          lat: VALID_GEOLOCATION.latitude,
          lng: VALID_GEOLOCATION.longitude
        },
        isApproximate: false
      },
      vendors: []
    },
    error: null
  };
}

function createVendor(index: number): Record<string, unknown> {
  const latitude = VALID_GEOLOCATION.latitude + index * 0.0025;
  const longitude = VALID_GEOLOCATION.longitude - index * 0.0025;

  return {
    vendor_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `Stress Vendor ${index}`,
    slug: `stress-vendor-${index}`,
    short_description: `Stress test vendor ${index}`,
    phone_number: `(214) 555-${String(1000 + index).slice(-4)}`,
    area: "Downtown",
    latitude,
    longitude,
    price_band: "standard",
    average_rating: 4.5,
    review_count: 10 + index,
    ranking_score: 100 - index,
    distance_km: index * 0.4,
    is_open_now: index % 2 === 1,
    featured_dish: {
      dish_name: `Dish ${index}`,
      description: null
    },
    today_hours: "09:00 - 18:00"
  };
}

async function expectUiResponsive(page: Page, localman: LocalManPage, message: string) {
  await expectPageNotBlank(page);
  await expectVisiblePageUi(page, message);
  await localman.expectPublicDiscoverySurface();
  await localman.expectMapOrFallback();

  const search = await getPrimarySearchInput(page);
  const filter = await getFilterButton(page);

  await expect(search, `${message} Expected the search input to remain visible.`).toBeVisible();
  await expect(search, `${message} Expected the search input to remain enabled.`).toBeEnabled();
  await expect(filter, `${message} Expected the filter control to remain visible.`).toBeVisible();
  await expect(filter, `${message} Expected the filter control to remain enabled.`).toBeEnabled();
}

async function getPrimarySearchInput(page: Page): Promise<Locator> {
  const search = await firstVisible([
    page.getByRole("searchbox", { name: /search/i }),
    page.getByRole("textbox", { name: /search/i }),
    page.getByRole("textbox", { name: /search|location|vendor|business/i })
  ]);

  expect(search, "Expected Local Man to render a visible primary search input.").not.toBeNull();
  return search!;
}

async function getFilterButton(page: Page): Promise<Locator> {
  const button = await firstVisible([
    page.getByRole("button", { name: /filter|open filters|close filters/i })
  ]);

  expect(button, "Expected Local Man to render a visible filter control.").not.toBeNull();
  return button!;
}

async function triggerSearch(page: Page, search: Locator) {
  const searchButton = await firstVisible([
    page.getByRole("button", { name: /^Search$/i }),
    page.getByRole("button", { name: /search/i })
  ], 1_000);

  if (searchButton && (await searchButton.isEnabled().catch(() => false))) {
    await searchButton.click();
  } else {
    await search.press("Enter").catch(() => undefined);
  }

  await search.blur().catch(() => undefined);
  await waitForPossibleRefresh(page);
}

async function waitForSearchSettle(page: Page, localman: LocalManPage) {
  await waitForPossibleRefresh(page);
  await localman.expectPublicDiscoverySurface();
  return localman.detectDiscoveryState().catch(() => null);
}

async function waitForPossibleRefresh(page: Page) {
  const apiResponse = page.waitForResponse(
    (response) => /\/api\/(?:vendors\/nearby|location\/reverse)/i.test(response.url()),
    { timeout: 1_500 }
  ).catch(() => null);
  const idle = page.waitForLoadState("networkidle", { timeout: 1_500 }).catch(() => undefined);

  await Promise.allSettled([apiResponse, idle]);
}

async function firstVisible(locators: Locator[], timeoutMs = 5_000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}
