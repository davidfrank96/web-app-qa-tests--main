import type { Browser, Locator, Page, Request, TestInfo } from "@playwright/test";
import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../../utils/assertions";
import { expect, test } from "../fixtures";

const INVALID_INPUT_PATTERN = /VALIDATION_ERROR:\s*Invalid input\.?/i;
const FALLBACK_UI_PATTERN =
  /Map view limited, vendors still available below|Turn on location for more accurate nearby vendors|Turn on your location to find accurate vendors near you|No vendors matched this search|No saved vendor yet|No vendor selected/i;
const DENIED_LOCATION_PATTERN = /Turn on location for more accurate nearby vendors|Showing nearby vendors/i;
const DEFAULT_LOCATION_SOURCE = "default_city";

type GeolocationApiEvent = {
  durationMs?: number;
  endpoint: string;
  failureReason?: string;
  kind: "requestfailed" | "response";
  method: string;
  status?: number;
};

test.describe("Local Man geolocation abuse", () => {
  test("invalid coordinates 999/999 do not crash and show fallback UI", async ({ browser, localmanResults }, testInfo) => {
    const { context, page } = await createPage(browser, testInfo, {
      permissions: ["geolocation"]
    });
    localmanResults.trackPage(page);

    try {
      await installInvalidCoordinateGeolocation(page, "out-of-range");

      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);
      const apiObserver = createGeolocationApiObserver(page, testInfo.title);

      await localman.gotoPublicDiscovery();
      await localman.expectPublicDiscoverySurface();
      await localman.expectMapOrFallback();
      await apiObserver.waitForActivity();

      await expect(page.getByText(INVALID_INPUT_PATTERN)).toBeVisible();
      await expectVisibleFallback(page);
      await expectStablePrimaryUi(page);

      expect(
        apiObserver.events.some((event) => event.status === 400),
        "Expected invalid coordinates to produce at least one 400 response on a geolocation-related endpoint."
      ).toBeTruthy();

      await apiObserver.expectNoUnexpectedIssues([/status=400/, /HTTP 400/i]);
      await monitor.expectNoCriticalIssues([/Failed to load resource: the server responded with a status of 400/i]);
    } finally {
      await context.close();
    }
  });

  test("invalid coordinates NaN/NaN do not crash and show fallback UI", async ({ browser, localmanResults }, testInfo) => {
    const { context, page } = await createPage(browser, testInfo, {
      permissions: ["geolocation"]
    });
    localmanResults.trackPage(page);

    try {
      await installInvalidCoordinateGeolocation(page, "nan");

      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);
      const apiObserver = createGeolocationApiObserver(page, testInfo.title);

      await localman.gotoPublicDiscovery();
      await localman.expectPublicDiscoverySurface();
      await localman.expectMapOrFallback();
      await apiObserver.waitForActivity();

      await expect(page.getByText(INVALID_INPUT_PATTERN)).toBeVisible();
      await expectVisibleFallback(page);
      await expectStablePrimaryUi(page);

      expect(
        apiObserver.events.some((event) => event.status === 400),
        "Expected NaN coordinates to produce at least one 400 response on a geolocation-related endpoint."
      ).toBeTruthy();

      await apiObserver.expectNoUnexpectedIssues([/status=400/, /HTTP 400/i]);
      await monitor.expectNoCriticalIssues([/Failed to load resource: the server responded with a status of 400/i]);
    } finally {
      await context.close();
    }
  });

  for (const scenario of [
    {
      coords: { latitude: 0, longitude: 0 },
      name: "ocean coordinates"
    },
    {
      coords: { latitude: 64.2008, longitude: -149.4937 },
      name: "remote area coordinates"
    }
  ]) {
    test(`extreme coordinates ${scenario.name} resolve to empty state or safe fallback without console errors`, async ({
      browser,
      localmanResults
    }, testInfo) => {
      const { context, page } = await createPage(browser, testInfo, {
        geolocation: scenario.coords,
        permissions: ["geolocation"]
      });
      localmanResults.trackPage(page);

      try {
        const localman = new LocalManPage(page);
        const monitor = createCriticalPageMonitor(page);
        const apiObserver = createGeolocationApiObserver(page, testInfo.title);

        await localman.gotoPublicDiscovery();
        await localman.expectPublicDiscoverySurface();
        await localman.expectMapOrFallback();
        await apiObserver.waitForActivity();

        const state = await localman.detectDiscoveryState();
        await localman.expectVendorCardsOrValidEmptyState(state);
        await expectStablePrimaryUi(page);

        const nearbyResponses = apiObserver.events.filter(
          (event) => event.kind === "response" && /\/api\/vendors\/nearby/i.test(event.endpoint)
        );
        expect(
          nearbyResponses.length,
          "Expected remote coordinates to hit the Local Man nearby vendor endpoint."
        ).toBeGreaterThan(0);
        expect(
          nearbyResponses.every((event) => event.status === 200),
          "Expected remote coordinate nearby vendor requests to complete without 4xx/5xx responses."
        ).toBeTruthy();

        await apiObserver.expectNoUnexpectedIssues();
        await monitor.expectNoCriticalIssues();
      } finally {
        await context.close();
      }
    });
  }

  test("rapid location changes stabilize without duplicate visible UI or crashes", async ({ browser, localmanResults }, testInfo) => {
    const { context, page } = await createPage(browser, testInfo, {
      geolocation: { latitude: 32.7767, longitude: -96.797 },
      permissions: ["geolocation"]
    });
    localmanResults.trackPage(page);

    try {
      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);
      const apiObserver = createGeolocationApiObserver(page, testInfo.title);

      await localman.gotoPublicDiscovery();
      await localman.expectPublicDiscoverySurface();

      for (const coords of [
        { latitude: 0, longitude: 0 },
        { latitude: 64.2008, longitude: -149.4937 },
        { latitude: 32.7767, longitude: -96.797 }
      ]) {
        await context.setGeolocation(coords);
        await page.reload({ waitUntil: "domcontentloaded" });
        await localman.expectPublicDiscoverySurface();
      }

      await localman.expectMapOrFallback();
      await expectSafeFinalState(page, localman);
      await expectStablePrimaryUi(page);

      const nearbyResponses = apiObserver.events.filter(
        (event) => event.kind === "response" && /\/api\/vendors\/nearby/i.test(event.endpoint) && event.status === 200
      );
      expect(
        nearbyResponses.length,
        "Expected rapid location changes to trigger multiple successful nearby vendor requests."
      ).toBeGreaterThanOrEqual(3);

      await apiObserver.expectNoUnexpectedIssues([/net::ERR_ABORTED/i]);
      await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
    } finally {
      await context.close();
    }
  });

  test("denied geolocation uses fallback location and keeps the map usable", async ({ browser, localmanResults }, testInfo) => {
    const { context, page } = await createPage(browser, testInfo, {
      permissions: []
    });
    localmanResults.trackPage(page);

    try {
      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);
      const apiObserver = createGeolocationApiObserver(page, testInfo.title);

      await localman.gotoPublicDiscovery();
      await localman.expectPublicDiscoverySurface();
      await localman.expectMapOrFallback();
      await expectVisibleAny(page, [page.getByText(DENIED_LOCATION_PATTERN)]);
      await expectStablePrimaryUi(page);

      const currentUrl = new URL(page.url());
      expect(
        currentUrl.searchParams.get("location_source"),
        "Expected denied geolocation to fall back to the Local Man default location source."
      ).toBe(DEFAULT_LOCATION_SOURCE);

      await apiObserver.expectNoUnexpectedIssues();
      await monitor.expectNoCriticalIssues();
    } finally {
      await context.close();
    }
  });
});

async function createPage(
  browser: Browser,
  testInfo: TestInfo,
  options: {
    geolocation?: {
      latitude: number;
      longitude: number;
    };
    permissions: string[];
  }
) {
  const context = await browser.newContext({
    baseURL: typeof testInfo.project.use.baseURL === "string" ? testInfo.project.use.baseURL : undefined,
    geolocation: options.geolocation,
    permissions: options.permissions
  });
  const page = await context.newPage();
  return { context, page };
}

async function installInvalidCoordinateGeolocation(page: Page, mode: "nan" | "out-of-range") {
  await page.addInitScript((currentMode) => {
    const coords =
      currentMode === "nan"
        ? { latitude: Number.NaN, longitude: Number.NaN, accuracy: 10 }
        : { latitude: 999, longitude: 999, accuracy: 10 };

    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: (position: GeolocationPosition) => void) {
          success({
            coords,
            timestamp: Date.now()
          } as GeolocationPosition);
        },
        watchPosition(success: (position: GeolocationPosition) => void) {
          success({
            coords,
            timestamp: Date.now()
          } as GeolocationPosition);
          return 1;
        },
        clearWatch() {
          return undefined;
        }
      }
    });
  }, mode);
}

function createGeolocationApiObserver(page: Page, label: string) {
  const requestStarts = new Map<Request, number>();
  const events: GeolocationApiEvent[] = [];

  page.on("request", (request) => {
    if (!isObservedEndpoint(request.url())) {
      return;
    }

    requestStarts.set(request, Date.now());
  });

  page.on("requestfailed", (request) => {
    if (!isObservedEndpoint(request.url())) {
      return;
    }

    const event: GeolocationApiEvent = {
      durationMs: Date.now() - (requestStarts.get(request) ?? Date.now()),
      endpoint: request.url(),
      failureReason: request.failure()?.errorText ?? "request failed",
      kind: "requestfailed",
      method: request.method()
    };
    events.push(event);
    console.log(`LOCALMAN_GEO_ABUSE ${JSON.stringify({ label, ...event })}`);
  });

  page.on("response", (response) => {
    if (!isObservedEndpoint(response.url())) {
      return;
    }

    const request = response.request();
    const event: GeolocationApiEvent = {
      durationMs: Date.now() - (requestStarts.get(request) ?? Date.now()),
      endpoint: response.url(),
      failureReason: response.status() >= 400 ? `HTTP ${response.status()}` : undefined,
      kind: "response",
      method: request.method(),
      status: response.status()
    };
    events.push(event);
    console.log(`LOCALMAN_GEO_ABUSE ${JSON.stringify({ label, ...event })}`);
  });

  return {
    events,
    async waitForActivity(timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (events.length > 0) {
          return;
        }

        await page.waitForTimeout(200);
      }
    },
    async expectNoUnexpectedIssues(ignorePatterns: RegExp[] = []) {
      const issues = events.filter((event) => hasIssue(event));
      const unexpected = issues.filter((event) => {
        const haystack = [
          event.endpoint,
          event.failureReason ?? "",
          event.method,
          event.kind,
          String(event.status ?? "")
        ];
        return !ignorePatterns.some((pattern) => haystack.some((value) => pattern.test(value)));
      });

      expect(
        unexpected.length,
        unexpected.length === 0
          ? "Expected no unexpected geolocation endpoint failures."
          : `Unexpected geolocation endpoint failures:\n${unexpected.map(formatGeolocationEvent).join("\n")}`
      ).toBe(0);
    }
  };
}

function isObservedEndpoint(url: string) {
  return /\/api\/(?:vendors\/nearby|location\/reverse)/i.test(url);
}

function hasIssue(event: GeolocationApiEvent) {
  return event.kind === "requestfailed" || (typeof event.status === "number" && event.status >= 400);
}

function formatGeolocationEvent(event: GeolocationApiEvent) {
  const duration = typeof event.durationMs === "number" ? `${event.durationMs}ms` : "unknown";
  const status = typeof event.status === "number" ? ` status=${event.status}` : "";
  const reason = event.failureReason ? ` reason=${event.failureReason}` : "";
  return `${event.kind} ${event.method} ${event.endpoint}${status} duration=${duration}${reason}`;
}

async function expectVisibleFallback(page: Page) {
  await expectVisibleAny(page, [
    page.getByText(INVALID_INPUT_PATTERN),
    page.getByText(FALLBACK_UI_PATTERN)
  ]);
}

async function expectSafeFinalState(page: Page, localman: LocalManPage) {
  const placeholder = await findVisibleByText(page, FALLBACK_UI_PATTERN);
  if (placeholder) {
    return;
  }

  const state = await localman.detectDiscoveryState();
  await localman.expectVendorCardsOrValidEmptyState(state);
}

async function expectStablePrimaryUi(page: Page) {
  const searchboxes = page.getByRole("textbox", { name: /search/i });
  const filterButtons = page.getByRole("button", { name: /filter|open filters|close filters/i });
  const headings = page.getByRole("heading", { name: /the local man/i });

  expect(await countVisible(searchboxes), "Expected exactly one visible Local Man search box.").toBe(1);
  expect(await countVisible(filterButtons), "Expected exactly one visible Local Man filter toggle.").toBe(1);
  expect(await countVisible(headings), "Expected exactly one visible Local Man primary heading.").toBe(1);
}

async function expectVisibleAny(page: Page, locators: Locator[]) {
  const visible = await firstVisible(locators);
  expect(visible, "Expected at least one visible fallback or geolocation status element.").not.toBeNull();
  await expect(visible!).toBeVisible();
}

async function firstVisible(locators: Locator[], timeoutMs = 8_000): Promise<Locator | null> {
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

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
}

async function findVisibleByText(page: Page, pattern: RegExp) {
  return firstVisible([page.getByText(pattern)]);
}

async function countVisible(locator: Locator) {
  const count = await locator.count();
  let visible = 0;

  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) {
      visible += 1;
    }
  }

  return visible;
}
