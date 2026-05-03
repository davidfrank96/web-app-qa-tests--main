import type { Locator, Page, Route } from "@playwright/test";
import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor, expectPageNotBlank, expectVisiblePageUi } from "../../../utils/assertions";
import { expect, test } from "../fixtures";

const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};

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

test.describe("Local Man UI abuse", () => {
  test.use({
    geolocation: VALID_GEOLOCATION,
    permissions: ["geolocation"]
  });

  test("rapid vendor-card clicks keep the selected vendor panel stable", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, 8);
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();
    await expect(page.locator("[data-vendor-id]").first()).toBeVisible();

    const previewButtons = await getVisibleVendorPreviewButtons(page, 4);
    expect(previewButtons.length, "Expected the mocked Local Man dataset to render visible vendor preview buttons.").toBeGreaterThanOrEqual(4);

    for (const button of previewButtons) {
      await button.click();
    }

    await expect(page.getByRole("heading", { name: /stress vendor 4/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /no vendor selected/i })).toHaveCount(0);
    await expectPrimaryUiStable(page, localman);
    await monitor.expectNoCriticalIssues();
  });

  test("rapid filter toggling does not break layout or primary controls", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, 6);
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    for (let cycle = 0; cycle < 8; cycle += 1) {
      const filterButton = await getFilterButton(page);
      await filterButton.click();
      await expect(await getFilterButton(page)).toBeVisible();
    }

    await expectPrimaryUiStable(page, localman);
    await monitor.expectNoCriticalIssues();
  });

  test("aggressive list and map scrolling keeps the discovery surface usable", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, 18);
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();
    await expect(page.locator("[data-vendor-id]").first()).toBeVisible();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.mouse.wheel(0, 1_600);
      await page.mouse.wheel(0, -1_200);
    }

    const mapContainer = page.getByRole("region", { name: /vendor map/i });
    await expect(mapContainer).toBeVisible();

    const mapBounds = await mapContainer.boundingBox();
    expect(mapBounds, "Expected the Local Man map container to expose a real layout box during scroll abuse.").not.toBeNull();
    await page.mouse.move(mapBounds!.x + mapBounds!.width / 2, mapBounds!.y + mapBounds!.height / 2);
    await page.mouse.wheel(0, 900);
    await page.mouse.wheel(0, -700);

    await expectPrimaryUiStable(page, localman);
    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });

  test("viewport transitions between mobile and desktop preserve usable layout", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, 10);
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await localman.expectPublicDiscoverySurface();
      await expectPrimaryUiStable(page, localman);
    }

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
  const uuid = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

  return {
    vendor_id: uuid,
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

async function expectPrimaryUiStable(page: Page, localman: LocalManPage) {
  await expectPageNotBlank(page);
  await expectVisiblePageUi(page, "Expected Local Man to keep rendering visible UI during stress interactions.");
  await localman.expectMapOrFallback();

  const search = await getSearchInput(page);
  const filter = await getFilterButton(page);

  await expectControlInteractable(search, "Expected the Local Man search input to remain interactable during UI abuse.");
  await expectControlInteractable(filter, "Expected the Local Man filter button to remain interactable during UI abuse.");
  await expectNoOverlap(search, filter, "Expected the Local Man search input and filter button not to overlap.");
  await expectResponsiveLayout(page);
}

async function getSearchInput(page: Page): Promise<Locator> {
  const search = await firstVisible([
    page.getByRole("searchbox", { name: /search/i }),
    page.getByRole("textbox", { name: /search/i })
  ]);
  expect(search, "Expected Local Man to render a visible search input.").not.toBeNull();
  return search!;
}

async function getFilterButton(page: Page): Promise<Locator> {
  const button = await firstVisible([page.getByRole("button", { name: /open filters|close filters|filter/i })]);
  expect(button, "Expected Local Man to render a visible filter toggle.").not.toBeNull();
  return button!;
}

async function getVisibleVendorPreviewButtons(page: Page, max: number): Promise<Locator[]> {
  const locator = page.locator("[data-vendor-id]").getByRole("button", { name: /preview .* on map/i });
  const count = await locator.count();
  const visible: Locator[] = [];

  for (let index = 0; index < count; index += 1) {
    const button = locator.nth(index);
    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    visible.push(button);
    if (visible.length >= max) {
      break;
    }
  }

  return visible;
}

async function firstVisible(locators: Locator[], timeoutMs = 5_000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      if (count === 0) {
        continue;
      }

      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    await pageWait(200);
  }

  return null;
}

async function expectControlInteractable(locator: Locator, message: string) {
  await expect(locator, message).toBeVisible();
  await expect(locator, message).toBeEnabled();
  await locator.scrollIntoViewIfNeeded();

  const box = await locator.boundingBox();
  expect(box, `${message} Expected a real layout box.`).not.toBeNull();
  expect(box!.width, `${message} Expected a non-zero width.`).toBeGreaterThan(0);
  expect(box!.height, `${message} Expected a non-zero height.`).toBeGreaterThan(0);

  let clickable = true;
  try {
    await locator.click({ trial: true });
  } catch {
    clickable = false;
  }

  expect(clickable, `${message} Expected the control not to be covered by overlapping UI.`).toBeTruthy();
}

async function expectNoOverlap(first: Locator, second: Locator, message: string) {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();

  expect(firstBox, `${message} Missing first control bounds.`).not.toBeNull();
  expect(secondBox, `${message} Missing second control bounds.`).not.toBeNull();

  const overlaps =
    firstBox!.x < secondBox!.x + secondBox!.width &&
    firstBox!.x + firstBox!.width > secondBox!.x &&
    firstBox!.y < secondBox!.y + secondBox!.height &&
    firstBox!.y + firstBox!.height > secondBox!.y;

  expect(overlaps, message).toBeFalsy();
}

async function expectResponsiveLayout(page: Page) {
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(
    hasHorizontalOverflow,
    "Expected the Local Man layout to fit the current viewport without horizontal overflow."
  ).toBeFalsy();
}

function isNearbyPayload(value: unknown): value is NearbyPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      "success" in value &&
      "data" in value &&
      typeof (value as NearbyPayload).success === "boolean" &&
      typeof (value as NearbyPayload).data === "object" &&
      Array.isArray((value as NearbyPayload).data.vendors)
  );
}

function pageWait(timeoutMs: number) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
