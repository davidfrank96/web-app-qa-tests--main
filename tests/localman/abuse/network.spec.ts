import type { Locator, Page, Request } from "@playwright/test";
import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor, expectPageNotBlank, expectVisiblePageUi } from "../../../utils/assertions";
import { expect, test } from "../fixtures";

const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};

const NETWORK_FALLBACK_PATTERN =
  /UNKNOWN_ERROR:\s*API request failed\.?|No vendors matched this search|Map view limited, vendors still available below|No vendor selected|No saved vendor yet|Turn on location for more accurate nearby vendors/i;
const NETWORK_LOADING_PATTERN = /Loading…|Loading\.\.\.|Finding nearby vendors/i;
const OFFLINE_STATE_PATTERN = /Reconnect to retry|offline|internet disconnected/i;
const PARTIAL_FAILURE_PATTERN = /UNKNOWN_ERROR:\s*API request failed\.?/i;
const SLOW_NETWORK_DELAY_MS = 4_500;
const THROTTLED_DISCOVERY_API_PATTERN = /\/api\/(?:vendors\/nearby|location\/reverse)/i;

type NetworkEvent = {
  durationMs?: number;
  endpoint: string;
  failureReason?: string;
  kind: "requestfailed" | "response";
  method: string;
  status?: number;
};

test.describe("Local Man network abuse", () => {
  test.use({
    geolocation: VALID_GEOLOCATION,
    permissions: ["geolocation"]
  });

  test("offline mode keeps the loaded discovery UI usable and shows fallback state", async ({ context, page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const observer = createNetworkObserver(page, testInfo.title);

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    await context.setOffline(true);
    const retryLocationButton = page.getByRole("button", { name: /retry location/i });
    await expect(retryLocationButton).toBeVisible();
    await expectVisibleAny(page, [page.getByText(OFFLINE_STATE_PATTERN), page.getByText(NETWORK_FALLBACK_PATTERN)]);

    if (await retryLocationButton.isDisabled().catch(() => false)) {
      await expect(retryLocationButton).toBeDisabled();

      const title = await retryLocationButton.getAttribute("title").catch(() => null);
      const hasOfflineTitle = typeof title === "string" && OFFLINE_STATE_PATTERN.test(title);
      const nearbyOfflineText = await findVisibleByText(page, OFFLINE_STATE_PATTERN, 3_000);

      expect(
        hasOfflineTitle || nearbyOfflineText !== null,
        'Expected the disabled "Retry Location" control to explain the offline state, such as "Reconnect to retry".'
      ).toBeTruthy();
    } else {
      await retryLocationButton.click();
      await observer.waitForActivity();
    }

    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, "Expected Local Man to keep rendering usable UI while offline.");
    await expectVisibleAny(page, [page.getByText(OFFLINE_STATE_PATTERN), page.getByText(NETWORK_FALLBACK_PATTERN)]);
    await localman.expectMapOrFallback();
    await expectPrimaryUiUsable(page);

    await observer.expectNoUnexpectedIssues([/ERR_INTERNET_DISCONNECTED/i]);
    await monitor.expectNoCriticalIssues([/ERR_INTERNET_DISCONNECTED/i]);
  });

  test("slow network keeps the discovery UI usable and avoids blank screens", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const observer = createNetworkObserver(page, testInfo.title);
    const nearbyResponse = page.waitForResponse((response) => {
      return /\/api\/vendors\/nearby/i.test(response.url()) && response.request().method() === "GET";
    });
    const reverseResponse = page.waitForResponse((response) => {
      return /\/api\/location\/reverse/i.test(response.url()) && response.request().method() === "GET";
    });

    await page.route("**/api/**", async (route) => {
      if (THROTTLED_DISCOVERY_API_PATTERN.test(route.request().url())) {
        await new Promise((resolve) => setTimeout(resolve, SLOW_NETWORK_DELAY_MS));
      }

      await route.continue();
    });

    await localman.gotoPublicDiscovery();

    const loadingState = await findVisibleByText(page, NETWORK_LOADING_PATTERN, 3_000);
    expect(
      loadingState,
      "Expected Local Man to show a visible loading state while the vendor API is delayed."
    ).not.toBeNull();

    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, "Expected Local Man to avoid a blank screen during slow vendor requests.");

    await Promise.all([nearbyResponse, reverseResponse]);
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();
    await observer.waitForActivity();

    await observer.expectNoUnexpectedIssues();
    await monitor.expectNoCriticalIssues();
  });

  test("vendor api 500 is handled gracefully with fallback UI", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const observer = createNetworkObserver(page, testInfo.title);

    await page.route("**/api/vendors/nearby**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          data: null,
          error: "SERVER_ERROR"
        })
      })
    );

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();
    await observer.waitForActivity();

    await expect(page.getByText(PARTIAL_FAILURE_PATTERN)).toBeVisible();
    await expectVisibleAny(page, [page.getByText(NETWORK_FALLBACK_PATTERN)]);
    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, "Expected Local Man to keep rendering usable UI after a vendor API failure.");
    await expectPrimaryUiUsable(page);

    await observer.expectNoUnexpectedIssues([/status=500/, /HTTP 500/i]);
    await monitor.expectNoCriticalIssues([
      /Critical response returned HTTP 500/i,
      /Failed to load resource: the server responded with a status of 500/i
    ]);
  });

  test("partial failure keeps the map usable when the vendor api fails", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const observer = createNetworkObserver(page, testInfo.title);

    await page.route("**/api/vendors/nearby**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          data: null,
          error: "SERVER_ERROR"
        })
      })
    );

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await observer.waitForActivity();

    await expect(page.getByText(PARTIAL_FAILURE_PATTERN)).toBeVisible();
    await expectMapReadyOrFallback(page);
    await expectPrimaryUiUsable(page);
    await expectPageNotBlank(page);

    await observer.expectNoUnexpectedIssues([/status=500/, /HTTP 500/i]);
    await monitor.expectNoCriticalIssues([
      /Critical response returned HTTP 500/i,
      /Failed to load resource: the server responded with a status of 500/i
    ]);
  });
});

function createNetworkObserver(page: Page, label: string) {
  const requestStarts = new Map<Request, number>();
  const events: NetworkEvent[] = [];

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

    const event: NetworkEvent = {
      durationMs: Date.now() - (requestStarts.get(request) ?? Date.now()),
      endpoint: request.url(),
      failureReason: request.failure()?.errorText ?? "request failed",
      kind: "requestfailed",
      method: request.method()
    };
    events.push(event);
    console.log(`LOCALMAN_NETWORK_ABUSE ${JSON.stringify({ label, ...event })}`);
  });

  page.on("response", (response) => {
    if (!isObservedEndpoint(response.url())) {
      return;
    }

    const request = response.request();
    const event: NetworkEvent = {
      durationMs: Date.now() - (requestStarts.get(request) ?? Date.now()),
      endpoint: response.url(),
      failureReason: response.status() >= 400 ? `HTTP ${response.status()}` : undefined,
      kind: "response",
      method: request.method(),
      status: response.status()
    };
    events.push(event);
    console.log(`LOCALMAN_NETWORK_ABUSE ${JSON.stringify({ label, ...event })}`);
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
          ? "Expected no unexpected Local Man network abuse issues."
          : `Unexpected Local Man network abuse issues:\n${unexpected.map(formatNetworkEvent).join("\n")}`
      ).toBe(0);
    }
  };
}

function isObservedEndpoint(url: string) {
  return /\/api\/(?:vendors(?:\/nearby)?|location\/reverse)/i.test(url);
}

function hasIssue(event: NetworkEvent) {
  return event.kind === "requestfailed" || (typeof event.status === "number" && event.status >= 400);
}

function formatNetworkEvent(event: NetworkEvent) {
  const duration = typeof event.durationMs === "number" ? `${event.durationMs}ms` : "unknown";
  const status = typeof event.status === "number" ? ` status=${event.status}` : "";
  const reason = event.failureReason ? ` reason=${event.failureReason}` : "";
  return `${event.kind} ${event.method} ${event.endpoint}${status} duration=${duration}${reason}`;
}

async function expectPrimaryUiUsable(page: Page) {
  await expectVisibleAny(page, [
    page.getByRole("textbox", { name: /search/i }),
    page.getByRole("searchbox", { name: /search/i })
  ]);
  await expectVisibleAny(page, [page.getByRole("button", { name: /filter|open filters|close filters/i })]);
}

async function expectMapReadyOrFallback(page: Page) {
  await expectVisibleAny(page, [
    page.getByRole("button", { name: /zoom in/i }),
    page.getByRole("button", { name: /zoom out/i }),
    page.getByRole("link", { name: /maplibre/i }),
    page.getByText(/Map view limited, vendors still available below/i)
  ]);
}

async function expectVisibleAny(page: Page, locators: Locator[]) {
  const visible = await firstVisible(locators);
  expect(visible, "Expected at least one visible fallback or primary UI element.").not.toBeNull();
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

async function findVisibleByText(page: Page, pattern: RegExp, timeoutMs = 8_000) {
  return firstVisible([page.getByText(pattern)], timeoutMs);
}
