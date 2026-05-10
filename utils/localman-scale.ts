import { expect, type Locator, type Page } from "@playwright/test";
import { LocalManPage } from "../pages/localman/localman-page";
import { expectPageNotBlank } from "./assertions";

export const LOCALMAN_SCALE_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
} as const;

export const LOCALMAN_SCALE_VENDOR_COUNTS = [1_000, 5_000, 10_000, 20_000] as const;

const TINY_IMAGE_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
const DEFAULT_LOCATION_LABEL = "Dallas, TX";

const NEIGHBORHOODS = ["Deep Ellum", "Downtown", "Oak Lawn", "Bishop Arts", "Lower Greenville"] as const;
const CUISINES = ["BBQ", "Tacos", "Coffee", "Soul Food", "Vegan"] as const;

export type LocalManScaleVendor = Record<string, unknown>;

export type LocalManScaleNearbyPayload = {
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
    vendors: LocalManScaleVendor[];
  };
  error: unknown;
};

export type LocalManScaleRequestEntry = {
  durationMs: number;
  query: string;
  requestNumber: number;
  route: string;
  timestamp: string;
  vendorCount: number;
};

type VendorResolverContext = {
  query: string;
  requestNumber: number;
  url: URL;
};

type DelayResolverContext = VendorResolverContext & {
  vendorCount: number;
};

export function generate1kVendorDataset() {
  return createLocalManScaleDataset(1_000);
}

export function generate5kVendorDataset() {
  return createLocalManScaleDataset(5_000);
}

export function generate10kVendorDataset() {
  return createLocalManScaleDataset(10_000);
}

export function generate20kVendorDataset() {
  return createLocalManScaleDataset(20_000);
}

export function createLocalManScaleDataset(
  count: number,
  options: {
    namePrefix?: string;
    versionTag?: string;
  } = {}
): LocalManScaleVendor[] {
  return Array.from({ length: count }, (_, index) =>
    createLocalManScaleVendor(index + 1, options)
  );
}

export async function installLocalManScaleMocks(
  page: Page,
  options: {
    locationLabel?: string;
    nearbyDelayMs?: number | ((context: DelayResolverContext) => number);
    reverseDelayMs?: number;
    vendors: LocalManScaleVendor[] | ((context: VendorResolverContext) => LocalManScaleVendor[]);
  }
) {
  const nearbyRequests: LocalManScaleRequestEntry[] = [];
  let inFlightNearbyRequests = 0;
  let nearbyRequestCount = 0;

  await page.route("**/api/location/reverse**", async (route) => {
    if (options.reverseDelayMs && options.reverseDelayMs > 0) {
      await delay(options.reverseDelayMs);
    }

    await route.fulfill({
      body: JSON.stringify({
        success: true,
        data: {
          location: {
            source: "precise",
            label: options.locationLabel ?? DEFAULT_LOCATION_LABEL,
            coordinates: {
              lat: LOCALMAN_SCALE_GEOLOCATION.latitude,
              lng: LOCALMAN_SCALE_GEOLOCATION.longitude
            },
            isApproximate: false
          }
        },
        error: null
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.route("**/api/vendors/nearby**", async (route) => {
    const startedAt = Date.now();
    const requestNumber = ++nearbyRequestCount;
    const url = new URL(route.request().url());
    const query = getQuery(url);
    const sourceVendors =
      typeof options.vendors === "function"
        ? options.vendors({ query, requestNumber, url })
        : options.vendors;
    const filteredVendors = filterVendorsByQuery(sourceVendors, query);
    const nearbyDelayMs =
      typeof options.nearbyDelayMs === "function"
        ? options.nearbyDelayMs({
            query,
            requestNumber,
            url,
            vendorCount: filteredVendors.length
          })
        : options.nearbyDelayMs ?? 0;

    inFlightNearbyRequests += 1;

    if (nearbyDelayMs > 0) {
      await delay(nearbyDelayMs);
    }

    const payload = createNearbyPayload(filteredVendors, options.locationLabel ?? DEFAULT_LOCATION_LABEL);
    await route.fulfill({
      body: JSON.stringify(payload),
      contentType: "application/json",
      status: 200
    });

    inFlightNearbyRequests -= 1;

    const entry: LocalManScaleRequestEntry = {
      durationMs: Date.now() - startedAt,
      query,
      requestNumber,
      route: toRoute(url.toString()),
      timestamp: new Date().toISOString(),
      vendorCount: filteredVendors.length
    };

    nearbyRequests.push(entry);
    logLocalManScaleMetric({
      durationMs: entry.durationMs,
      kind: "nearby-mock",
      query: entry.query,
      requestNumber: entry.requestNumber,
      route: entry.route,
      vendorCount: entry.vendorCount
    });
  });

  return {
    nearbyRequests,
    getInFlightNearbyRequestCount() {
      return inFlightNearbyRequests;
    }
  };
}

export async function expectLocalManScaleUiResponsive(
  page: Page,
  localman: LocalManPage,
  message = "Expected Local Man to remain interactive during scale QA.",
  options: {
    includeMap?: boolean;
  } = {}
) {
  await expectPageNotBlank(page);
  await expect(
    page.getByRole("heading", { name: /the local man|nearby|vendors?|discover/i }).first(),
    `${message} Expected Local Man to keep a visible page heading.`
  ).toBeVisible();

  const searchInput = await getLocalManSearchInput(page);
  const filterButton = await getLocalManFilterButton(page);

  await expectControlInteractable(searchInput, `${message} Search input is not interactive.`);
  await expectControlInteractable(filterButton, `${message} Filter button is not interactive.`);

  if (options.includeMap) {
    await localman.expectMapOrFallback();
  }
}

export async function submitLocalManSearch(page: Page, query: string) {
  const searchInput = await getLocalManSearchInput(page);
  await searchInput.fill(query);
  await searchInput.press("Enter");
}

export async function getLocalManSearchInput(page: Page): Promise<Locator> {
  const locator = await firstVisible(
    [
      page.getByRole("searchbox", { name: /search/i }),
      page.getByRole("textbox", { name: /search|vendor|business/i }),
      page.locator("input[type='search']"),
      page.locator("input[placeholder*='search' i]")
    ],
    5_000
  );

  expect(locator, "Expected Local Man to render a visible search input for scale QA.").not.toBeNull();
  return locator!;
}

export async function getLocalManFilterButton(page: Page): Promise<Locator> {
  const locator = await firstVisible(
    [
      page.getByRole("button", { name: /open filters|close filters|filter/i }),
      page.locator("button").filter({ hasText: /filter/i })
    ],
    5_000
  );

  expect(locator, "Expected Local Man to render a visible filter button for scale QA.").not.toBeNull();
  return locator!;
}

export async function getVisibleVendorNames(page: Page, max = 12): Promise<string[]> {
  const cards = await getVisibleVendorCards(page, max);
  return Promise.all(cards.map((card) => getVendorName(card)));
}

export async function getVisibleVendorCards(page: Page, max = 12): Promise<Locator[]> {
  for (const locator of vendorCardLocatorCandidates(page)) {
    const visible = await visibleLocators(locator, max);
    if (visible.length > 0) {
      return visible;
    }
  }

  return [];
}

export async function expectNoDuplicateVisibleVendorCards(page: Page, max = 12) {
  const cards = await getVisibleVendorCards(page, max);
  expect(cards.length, "Expected Local Man to render visible vendor cards for scale QA.").toBeGreaterThan(0);

  const names = await Promise.all(cards.map((card) => getVendorName(card)));
  expect(
    names.every((name) => name !== ""),
    `Expected visible Local Man vendor cards to expose readable names. Received: ${names.join(" | ")}`
  ).toBeTruthy();

  const uniqueNames = new Set(names);
  expect(
    uniqueNames.size,
    `Expected Local Man not to render duplicate visible vendor cards. Rendered names: ${names.join(" | ")}`
  ).toBe(names.length);
}

export async function getVisibleVendorPreviewButtons(page: Page, max = 8): Promise<Locator[]> {
  const previewButtons = page
    .getByRole("button", { name: /preview .* on map|show .* on map|select .* on map/i });
  return visibleLocators(previewButtons, max);
}

export async function getVendorNameForPreviewButton(button: Locator): Promise<string> {
  const card = button.locator("xpath=ancestor::*[@data-vendor-id or self::article or self::li][1]").first();
  return getVendorName(card);
}

export async function getSelectedVendorName(page: Page): Promise<string | null> {
  const selectedSurface = await getSelectedVendorSurface(page);
  if (!selectedSurface) {
    return null;
  }

  const name = await getVendorName(selectedSurface);
  return name || null;
}

export function logLocalManScaleMetric(metric: Record<string, unknown>) {
  console.log(
    `LOCALMAN_SCALE ${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...metric
    })}`
  );
}

function createLocalManScaleVendor(
  index: number,
  options: {
    namePrefix?: string;
    versionTag?: string;
  } = {}
): LocalManScaleVendor {
  const paddedIndex = String(index).padStart(5, "0");
  const neighborhood = NEIGHBORHOODS[(index - 1) % NEIGHBORHOODS.length];
  const cuisine = CUISINES[(index - 1) % CUISINES.length];
  const row = Math.floor((index - 1) / 150);
  const column = (index - 1) % 150;
  const latitude = Number((LOCALMAN_SCALE_GEOLOCATION.latitude + row * 0.0015).toFixed(6));
  const longitude = Number((LOCALMAN_SCALE_GEOLOCATION.longitude - column * 0.0015).toFixed(6));
  const versionSuffix = options.versionTag ? ` ${options.versionTag}` : "";
  const prefix = options.namePrefix ?? "QA_TEST_Scale Vendor";

  return {
    vendor_id: createUuid(index),
    slug: `qa-scale-vendor-${paddedIndex}${options.versionTag ? `-${slugify(options.versionTag)}` : ""}`,
    name: `${prefix} ${paddedIndex}${versionSuffix}`,
    is_test: true,
    short_description: `${cuisine} vendor in ${neighborhood} for deterministic Local Man scale QA${versionSuffix}.`,
    description: `${cuisine} vendor in ${neighborhood} for deterministic Local Man scale QA${versionSuffix}.`,
    area: neighborhood,
    category: cuisine,
    cuisine,
    latitude,
    longitude,
    price_band: index % 3 === 0 ? "premium" : index % 2 === 0 ? "standard" : "budget",
    average_rating: Number((3.8 + (index % 12) * 0.1).toFixed(1)),
    review_count: 20 + (index % 80),
    ranking_score: 100_000 - index,
    distance_km: Number((0.1 + (index % 120) * 0.08).toFixed(2)),
    is_open_now: index % 2 === 0,
    phone_number: `(214) 555-${String(1000 + (index % 9000)).slice(-4)}`,
    today_hours: "09:00 - 18:00",
    featured_dish: {
      dish_name: `${cuisine} Feature ${paddedIndex}`,
      description: null
    },
    image: TINY_IMAGE_DATA_URL,
    imageUrl: TINY_IMAGE_DATA_URL,
    image_url: TINY_IMAGE_DATA_URL,
    images: [TINY_IMAGE_DATA_URL],
    thumbnailUrl: TINY_IMAGE_DATA_URL
  };
}

function createNearbyPayload(vendors: LocalManScaleVendor[], locationLabel: string): LocalManScaleNearbyPayload {
  return {
    success: true,
    data: {
      location: {
        source: "precise",
        label: locationLabel,
        coordinates: {
          lat: LOCALMAN_SCALE_GEOLOCATION.latitude,
          lng: LOCALMAN_SCALE_GEOLOCATION.longitude
        },
        isApproximate: false
      },
      vendors
    },
    error: null
  };
}

function filterVendorsByQuery(vendors: LocalManScaleVendor[], query: string): LocalManScaleVendor[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return vendors;
  }

  return vendors.filter((vendor) => searchableVendorText(vendor).includes(normalizedQuery));
}

function searchableVendorText(vendor: LocalManScaleVendor): string {
  const featuredDish = isObject(vendor.featured_dish) ? vendor.featured_dish.dish_name : "";
  return [
    vendor.name,
    vendor.slug,
    vendor.short_description,
    vendor.description,
    vendor.area,
    vendor.category,
    vendor.cuisine,
    featuredDish
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

function getQuery(url: URL): string {
  return (
    url.searchParams.get("search") ??
    url.searchParams.get("q") ??
    url.searchParams.get("query") ??
    ""
  ).trim();
}

function vendorCardLocatorCandidates(page: Page): Locator[] {
  const mainContent = "main, [role='main']";
  const cardHeading = page.locator("h1, h2, h3, [role='heading']");
  const cardAction = page.locator("a[href], button");
  const excludedText =
    /no vendor selected|no vendors matched this search|no saved vendor yet|no recent views yet|no popularity signal yet/i;

  return [
    page.locator("[data-vendor-id]").filter({ has: cardHeading }).filter({ hasNotText: excludedText }),
    page
      .getByRole("button", { name: /preview .* on map|show .* on map|select .* on map/i })
      .locator("xpath=ancestor::*[@data-vendor-id or self::article or self::li][1]")
      .filter({ has: cardHeading })
      .filter({ hasNotText: excludedText }),
    page
      .locator(`${mainContent} article, ${mainContent} [role='article']`)
      .filter({ has: cardHeading })
      .filter({ has: cardAction })
      .filter({ hasNotText: excludedText }),
    page
      .locator(`${mainContent} li, ${mainContent} [role='listitem']`)
      .filter({ has: cardHeading })
      .filter({ has: cardAction })
      .filter({ hasNotText: excludedText })
  ];
}

async function getSelectedVendorSurface(page: Page): Promise<Locator | null> {
  const candidates = [
    page
      .locator("main section, main article, main aside, [role='main'] section, [role='main'] article, [role='main'] aside")
      .filter({
        has: page.locator("h1, h2, h3, [role='heading']")
      })
      .filter({
        has: page.locator("a[href^='tel:'], button, a[href*='maps'], a[href*='google.com/maps']")
      }),
    page.getByText(/selected vendor/i).locator("xpath=ancestor::*[self::section or self::article or self::aside][1]")
  ];

  return firstVisible(candidates, 3_000);
}

async function getVendorName(locator: Locator): Promise<string> {
  const nameLocator = locator.locator("h1, h2, h3, [role='heading'], a[href]").first();
  const text = normalizeText(await readLocatorText(nameLocator));
  if (text) {
    return text;
  }

  return normalizeText(await readLocatorText(locator));
}

async function visibleLocators(locator: Locator, max: number): Promise<Locator[]> {
  const count = await locator.count();
  const visible: Locator[] = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    visible.push(candidate);
    if (visible.length >= max) {
      break;
    }
  }

  return visible;
}

async function firstVisible(locators: Locator[], timeoutMs: number): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const visible = await visibleLocators(locator, 1);
      if (visible.length > 0) {
        return visible[0]!;
      }
    }

    await delay(200);
  }

  return null;
}

async function expectControlInteractable(locator: Locator, message: string) {
  await expect(locator, message).toBeVisible();
  await expect(locator, message).toBeEnabled();
  await locator.scrollIntoViewIfNeeded();

  const box = await locator.boundingBox();
  expect(box, `${message} Expected a real layout box.`).not.toBeNull();
  expect(box!.width, `${message} Expected the control to have non-zero width.`).toBeGreaterThan(0);
  expect(box!.height, `${message} Expected the control to have non-zero height.`).toBeGreaterThan(0);

  let clickable = true;
  try {
    await locator.click({ timeout: 1_500, trial: true });
  } catch {
    clickable = false;
  }

  expect(clickable, `${message} Expected the control not to be blocked by overlapping UI.`).toBeTruthy();
}

function createUuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function toRoute(urlOrPath: string): string {
  if (!urlOrPath) {
    return "/";
  }

  try {
    const url = new URL(urlOrPath);
    return `${url.pathname}${url.search}`;
  } catch {
    return urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

async function readLocatorText(locator: Locator): Promise<string> {
  try {
    return await locator.evaluate((node) => node.textContent ?? "");
  } catch {
    return (await locator.textContent({ timeout: 2_000 }).catch(() => "")) ?? "";
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
