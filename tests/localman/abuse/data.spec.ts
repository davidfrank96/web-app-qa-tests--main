import type { Locator, Page, Route } from "@playwright/test";
import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor, expectPageNotBlank, expectVisiblePageUi } from "../../../utils/assertions";
import { expect, test } from "../fixtures";

const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};

const TINY_IMAGE_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";

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

test.describe("Local Man data abuse", () => {
  test.use({
    geolocation: VALID_GEOLOCATION,
    permissions: ["geolocation"]
  });

  test("malformed vendor records do not break discovery and safe fallbacks are used", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, ({ vendorFactory, payload }) => ({
      ...payload,
      data: {
        ...payload.data,
        vendors: [
          vendorFactory(1, {
            name: "Baseline Vendor One"
          }),
          vendorFactory(2, {
            image: "https://example.invalid/broken-image.jpg",
            imageUrl: "https://example.invalid/broken-image.jpg",
            image_url: "https://example.invalid/broken-image.jpg",
            images: ["https://example.invalid/broken-image.jpg"],
            name: "Broken Image Vendor",
            thumbnailUrl: "https://example.invalid/broken-image.jpg"
          }),
          vendorFactory(3, {
            coordinates: undefined,
            latitude: undefined,
            location: undefined,
            longitude: undefined,
            name: "Missing Coordinate Vendor"
          }),
          vendorFactory(4, {
            name: undefined,
            title: undefined,
            vendorName: undefined
          })
        ]
      }
    }));

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    const state = await localman.detectDiscoveryState();
    await localman.expectVendorCardsOrValidEmptyState(state);
    await expectVisibleVendorShell(page);

    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, "Expected Local Man to keep rendering usable discovery UI for malformed vendor data.");

    const cards = await getVisibleVendorCards(page);
    expect(cards.length, "Expected at least one visible vendor card from the malformed vendor dataset.").toBeGreaterThan(0);

    for (const card of cards) {
      const name = await getVendorCardName(card);
      expect(name, "Expected each rendered malformed-data vendor card to expose a readable non-empty name or fallback label.").not.toBe("");
      expect(name, `Expected Local Man to avoid rendering invalid fallback text for vendor cards, received "${name}".`).not.toMatch(
        /undefined|null|nan/i
      );

      const cardText = normalizeText(await card.textContent());
      expect(
        cardText,
        `Expected Local Man to avoid leaking raw malformed values into the vendor card UI. Received: "${cardText}".`
      ).not.toMatch(/undefined|null|nan/i);
    }

    await expectNoBrokenVisibleImages(page);
    await monitor.expectNoCriticalIssues();
  });

  test("duplicate vendor payloads do not render duplicate visible vendor cards", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, ({ vendorFactory, payload }) => {
      const alpha = vendorFactory(1, {
        name: "Duplicate Vendor Alpha"
      });
      const beta = vendorFactory(2, {
        name: "Duplicate Vendor Beta"
      });

      return {
        ...payload,
        data: {
          ...payload.data,
          vendors: [
            alpha,
            alpha,
            beta,
            beta
          ]
        }
      };
    });

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();
    await localman.expectVendorCardsVisible();
    await expectVisibleVendorShell(page);

    const cards = await getVisibleVendorCards(page, 8);
    expect(cards.length, "Expected visible vendor cards when duplicate vendors are returned from the API.").toBeGreaterThan(0);

    const names = await Promise.all(cards.map((card) => getVendorCardName(card)));
    const signatures = await Promise.all(cards.map((card) => cardSignature(card)));
    const uniqueNames = new Set(names.filter((name) => name !== ""));
    const uniqueSignatures = new Set(signatures);

    expect(
      uniqueNames.size,
      `Expected duplicate vendor payloads to be deduplicated in the UI. Rendered names: ${names.join(", ")}`
    ).toBe(names.length);
    expect(
      uniqueSignatures.size,
      "Expected duplicate vendor payloads not to render identical visible vendor cards more than once."
    ).toBe(signatures.length);

    await monitor.expectNoCriticalIssues();
  });

  test("large vendor datasets stay performant and visually stable", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await mockNearbyPayload(page, ({ vendorFactory, payload }) => ({
      ...payload,
      data: {
        ...payload.data,
        vendors: Array.from({ length: 75 }, (_, index) =>
          vendorFactory(index + 1, {
            name: `Load Test Vendor ${String(index + 1).padStart(2, "0")}`
          })
        )
      }
    }));

    const startedAt = Date.now();
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();
    await localman.expectVendorCardsVisible();
    await expectVisibleVendorShell(page);
    const loadDurationMs = Date.now() - startedAt;

    console.log(
      `LOCALMAN_DATA_ABUSE ${JSON.stringify({
        durationMs: loadDurationMs,
        metric: "large-dataset-load",
        route: page.url(),
        status: loadDurationMs > 10_000 ? "broken" : loadDurationMs > 5_000 ? "slow" : "healthy",
        vendorCount: 75
      })}`
    );

    expect(
      loadDurationMs,
      `Expected Local Man to remain usable with a large vendor dataset within 10s, received ${loadDurationMs}ms.`
    ).toBeLessThanOrEqual(10_000);

    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, "Expected Local Man to keep rendering usable UI for a large vendor dataset.");

    const cards = await getVisibleVendorCards(page, 12);
    expect(cards.length, "Expected the Local Man discovery UI to show visible vendor cards for the large mocked dataset.").toBeGreaterThan(0);

    const names = await Promise.all(cards.map((card) => getVendorCardName(card)));
    const uniqueNames = new Set(names.filter((name) => name !== ""));
    expect(
      uniqueNames.size,
      "Expected the first visible vendor cards from the large dataset not to contain duplicate renders."
    ).toBe(names.length);

    await expectNoBrokenVisibleImages(page);
    await monitor.expectNoCriticalIssues();
  });
});

async function mockNearbyPayload(
  page: Page,
  transform: (context: {
    payload: NearbyPayload;
    vendorFactory: (index: number, overrides?: Partial<Record<string, unknown>>) => Record<string, unknown>;
  }) => NearbyPayload
) {
  await page.route("**/api/vendors/nearby**", async (route) => {
    const payload = await resolveNearbyPayload(route);
    const seedVendor = payload.data.vendors.find(isObject);
    const vendorFactory = (index: number, overrides: Partial<Record<string, unknown>> = {}) =>
      createVendor(seedVendor ?? null, index, overrides);
    const nextPayload = transform({ payload, vendorFactory });

    await route.fulfill({
      body: JSON.stringify(nextPayload),
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
        label: "Dallas, TX",
        coordinates: {
          lat: VALID_GEOLOCATION.latitude,
          lng: VALID_GEOLOCATION.longitude
        },
        isApproximate: false
      },
      vendors: [createVendor(null, 1)]
    },
    error: null
  };
}

function createVendor(
  seedVendor: Record<string, unknown> | null,
  index: number,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  const lat = VALID_GEOLOCATION.latitude + index * 0.004;
  const lng = VALID_GEOLOCATION.longitude - index * 0.004;
  const id = createUuid(index);
  const slug = `qa-local-vendor-${index}`;
  const base: Record<string, unknown> = {
    ...(seedVendor ?? {}),
    vendor_id: id,
    slug,
    name: `QA Local Vendor ${index}`,
    short_description: `Synthetic Local Man vendor ${index} for deterministic QA validation.`,
    phone_number: `(214) 555-${String(1000 + index).slice(-4)}`,
    area: "Downtown",
    latitude: lat,
    longitude: lng,
    price_band: "standard",
    average_rating: 4.4,
    review_count: 12 + index,
    ranking_score: 100 - index,
    distance_km: index,
    is_open_now: index % 2 === 0,
    featured_dish: {
      dish_name: `Test dish ${index}`,
      description: null
    },
    today_hours: "09:00 - 18:00",
    image: TINY_IMAGE_DATA_URL,
    imageUrl: TINY_IMAGE_DATA_URL,
    image_url: TINY_IMAGE_DATA_URL,
    images: [TINY_IMAGE_DATA_URL],
    thumbnailUrl: TINY_IMAGE_DATA_URL
  };

  return applyOverrides(base, overrides);
}

function applyOverrides(
  source: Record<string, unknown>,
  overrides: Partial<Record<string, unknown>>
): Record<string, unknown> {
  const next = { ...source };

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "undefined") {
      delete next[key];
      continue;
    }

    next[key] = value;
  }

  return next;
}

async function getVisibleVendorCards(page: Page, max = 10): Promise<Locator[]> {
  const candidates = [
    page.locator("[data-vendor-id]"),
    page
      .locator(
        [
          "[data-testid*='vendor']",
          "[data-testid*='business']",
          "[data-testid*='listing']",
          "[data-test*='vendor']",
          "[data-qa*='vendor']"
        ].join(", ")
      )
      .filter({ has: page.locator("h1, h2, h3, [role='heading']") }),
    page
      .locator("main article, [role='main'] article, main [role='article'], [role='main'] [role='article']")
      .filter({ has: page.locator("button, a[href], h1, h2, h3, [role='heading']") }),
    page
      .locator("main li, [role='main'] li, main [role='listitem'], [role='main'] [role='listitem']")
      .filter({ has: page.locator("button, a[href], h1, h2, h3, [role='heading']") })
  ];

  for (const candidate of candidates) {
    const visible: Locator[] = [];
    const total = await candidate.count();

    for (let index = 0; index < total; index += 1) {
      const item = candidate.nth(index);
      if (!(await item.isVisible().catch(() => false))) {
        continue;
      }

      visible.push(item);
      if (visible.length >= max) {
        return visible;
      }
    }

    if (visible.length > 0) {
      return visible;
    }
  }

  return [];
}

async function getVendorCardName(card: Locator): Promise<string> {
  const candidates = [
    card.getByRole("heading"),
    card.locator("h1, h2, h3"),
    card.getByRole("link").filter({ has: card.locator("h1, h2, h3, [role='heading']") })
  ];

  for (const candidate of candidates) {
    const current = candidate.first();
    if (await current.isVisible().catch(() => false)) {
      return normalizeText(await current.textContent());
    }
  }

  return "";
}

async function cardSignature(card: Locator): Promise<string> {
  return normalizeText(await card.textContent());
}

async function expectNoBrokenVisibleImages(page: Page) {
  const images = page.locator("main img, [role='main'] img");
  const total = await images.count();

  for (let index = 0; index < total; index += 1) {
    const image = images.nth(index);
    if (!(await image.isVisible().catch(() => false))) {
      continue;
    }

    const state = await image.evaluate((element) => {
      const img = element as HTMLImageElement;
      return {
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        src: img.currentSrc || img.getAttribute("src") || ""
      };
    });

    expect(
      state.complete && state.naturalWidth > 0,
      `Expected Local Man to avoid showing broken visible images. Received image source "${state.src}".`
    ).toBeTruthy();
  }
}

async function expectVisibleVendorShell(page: Page) {
  await expect(
    page.locator("[data-vendor-id]").first(),
    "Expected Local Man to render at least one visible vendor card shell."
  ).toBeVisible({ timeout: 15_000 });
}

function isNearbyPayload(value: unknown): value is NearbyPayload {
  return Boolean(
    isObject(value) &&
      typeof value.success === "boolean" &&
      isObject(value.data) &&
      isObject(value.data.location) &&
      Array.isArray(value.data.vendors)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
