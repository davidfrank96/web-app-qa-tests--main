import { expect, type Page, type Request } from "@playwright/test";
import { LocalManPage } from "../../../pages/localman/localman-page";
import {
  createCriticalPageMonitor,
  expectPageNotBlank,
  expectPageReady,
  expectVisiblePageUi
} from "../../../utils/assertions";
import { LOCALMAN_EMPTY_STATE_PATTERN, type LocalManDiscoveryState } from "../../../utils/test-data";
import { test } from "../fixtures";

const VALIDATION_PATTERN = /VALIDATION_ERROR:\s*Invalid input\.?/i;
const FALLBACK_UI_PATTERN =
  /Map view limited, vendors still available below|Turn on location for more accurate nearby vendors|Turn on your location to find accurate vendors near you|No vendors matched this search|No saved vendor yet|No vendor selected|Showing nearby vendors/i;
const SAFE_DEEP_LINK_PATTERN = /not found|404|vendor detail unavailable|no vendor selected|back|search|discover/i;
const SAFE_ERROR_IGNORE_PATTERNS = [/Failed to load resource: the server responded with a status of 400/i, VALIDATION_PATTERN];

const TAMPERED_DISCOVERY_CASES = [
  {
    path: "/?location_source=invalid",
    title: "invalid location_source falls back safely"
  },
  {
    path: "/?location_source=precise&lat=9999999999999999&lng=-9999999999999999",
    title: "extreme lat/lng values fall back safely"
  },
  {
    path: "/?location_source=default_city&foo=bar&unexpected=1&debug=true",
    title: "unknown query params are ignored safely"
  }
] as const;

type UrlApiEvent = {
  durationMs?: number;
  endpoint: string;
  failureReason?: string;
  kind: "requestfailed" | "response";
  method: string;
  status?: number;
};

test.describe("Local Man URL tampering safety", () => {
  for (const scenario of TAMPERED_DISCOVERY_CASES) {
    test(scenario.title, async ({ page }) => {
      const localman = new LocalManPage(page);
      const monitor = createCriticalPageMonitor(page);
      const apiObserver = createUrlApiObserver(page, scenario.title);

      await page.goto(scenario.path, { waitUntil: "domcontentloaded" });
      await expectPageReady(page);
      await expectPageNotBlank(page);
      await expectVisiblePageUi(
        page,
        `Expected Local Man to render visible UI after opening tampered discovery URL "${scenario.path}".`
      );
      await localman.expectPublicDiscoverySurface();
      await localman.expectMapOrFallback();
      await apiObserver.waitForActivity();

      const state = await detectDiscoveryStateOrNull(localman);
      if (state) {
        await localman.expectVendorCardsOrValidEmptyState(state);
      } else {
        await expectSafeFallback(page, scenario.path);
      }

      expectNoServerFailures(apiObserver.events, scenario.path);
      await monitor.expectNoCriticalIssues(SAFE_ERROR_IGNORE_PATTERNS);
    });
  }

  test("random vendor deep links are handled safely", async ({ page }) => {
    const randomVendorPath = `/vendors/qa-random-missing-${Date.now().toString(36)}`;
    const monitor = createCriticalPageMonitor(page);

    const response = await page.goto(randomVendorPath, { waitUntil: "domcontentloaded" });
    await expectPageReady(page);
    await expectPageNotBlank(page);
    await expectVisiblePageUi(
      page,
      `Expected Local Man to render a safe visible surface for deep link "${randomVendorPath}".`
    );

    const status = response?.status() ?? 0;
    expect(
      status < 500,
      `Expected Local Man deep link "${randomVendorPath}" to avoid 5xx responses, but received ${status}.`
    ).toBeTruthy();

    const bodyText = normalizeText(await page.locator("body").textContent());
    expect(
      /typeerror|referenceerror|stack trace|cannot read|undefined is not an object|unhandled/i.test(bodyText),
      `Expected Local Man deep link "${randomVendorPath}" to avoid crashing or leaking runtime errors.`
    ).toBeFalsy();

    const safeFallbackVisible =
      SAFE_DEEP_LINK_PATTERN.test(bodyText) ||
      Boolean(
        await firstVisibleText(page, [
          page.getByText(/not found|vendor detail unavailable|no vendor selected/i),
          page.getByRole("button", { name: /back/i }),
          page.getByRole("link", { name: /back|search|discover/i }),
          page.getByRole("searchbox"),
          page.getByRole("textbox", { name: /search|location|vendor|business/i })
        ])
      );

    expect(
      safeFallbackVisible,
      `Expected Local Man deep link "${randomVendorPath}" to show a safe fallback surface instead of a broken page.`
    ).toBeTruthy();

    await monitor.expectNoCriticalIssues();
  });
});

function createUrlApiObserver(page: Page, label: string) {
  const requestStarts = new Map<Request, number>();
  const events: UrlApiEvent[] = [];

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

    const event: UrlApiEvent = {
      durationMs: elapsedSinceRequest(requestStarts, request),
      endpoint: request.url(),
      failureReason: request.failure()?.errorText ?? "request failed",
      kind: "requestfailed",
      method: request.method()
    };
    events.push(event);
    console.log(`LOCALMAN_URL_TAMPER ${JSON.stringify({ label, ...event })}`);
  });

  page.on("response", (response) => {
    if (!isObservedEndpoint(response.url())) {
      return;
    }

    const request = response.request();
    const event: UrlApiEvent = {
      durationMs: elapsedSinceRequest(requestStarts, request),
      endpoint: response.url(),
      kind: "response",
      method: request.method(),
      status: response.status()
    };
    events.push(event);
    console.log(`LOCALMAN_URL_TAMPER ${JSON.stringify({ label, ...event })}`);
  });

  return {
    events,
    async waitForActivity(timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (events.length > 0) {
          return;
        }

        await page.waitForTimeout(100);
      }

      throw new Error(`Expected Local Man tampered URL flow "${label}" to trigger at least one nearby/location API event.`);
    }
  };
}

function isObservedEndpoint(url: string) {
  return /\/api\/(?:vendors\/nearby|location\/reverse)/i.test(url);
}

function elapsedSinceRequest(requestStarts: Map<Request, number>, request: Request) {
  return Date.now() - (requestStarts.get(request) ?? Date.now());
}

async function detectDiscoveryStateOrNull(localman: LocalManPage): Promise<LocalManDiscoveryState | null> {
  try {
    return await localman.detectDiscoveryState();
  } catch {
    return null;
  }
}

async function expectSafeFallback(page: Page, route: string) {
  const bodyText = normalizeText(await page.locator("body").textContent());
  const hasSafeText =
    VALIDATION_PATTERN.test(bodyText) ||
    FALLBACK_UI_PATTERN.test(bodyText) ||
    LOCALMAN_EMPTY_STATE_PATTERN.test(bodyText);

  if (hasSafeText) {
    return;
  }

  const visibleFallback = await firstVisibleText(page, [
    page.getByText(VALIDATION_PATTERN),
    page.getByText(FALLBACK_UI_PATTERN),
    page.getByText(LOCALMAN_EMPTY_STATE_PATTERN)
  ]);

  expect(
    Boolean(visibleFallback),
    `Expected Local Man tampered URL "${route}" to show a safe fallback or empty-state surface when discovery results do not render normally.`
  ).toBeTruthy();
}

function expectNoServerFailures(events: UrlApiEvent[], route: string) {
  const failures = events.filter(
    (event) => event.kind === "requestfailed" || (typeof event.status === "number" && event.status >= 500)
  );

  expect(
    failures,
    failures.length === 0
      ? `Expected Local Man tampered URL "${route}" to avoid request failures and 5xx API responses.`
      : `Unexpected request failures or 5xx responses for tampered URL "${route}":\n${failures
          .map((event) => `${event.kind} ${event.method} ${event.endpoint} status=${String(event.status ?? "n/a")} reason=${event.failureReason ?? "none"}`)
          .join("\n")}`
  ).toEqual([]);
}

async function firstVisibleText(page: Page, locators: Array<ReturnType<Page["getByText"]> | ReturnType<Page["getByRole"]>>) {
  for (const locator of locators) {
    if (await locator.first().isVisible().catch(() => false)) {
      return locator.first();
    }
  }

  return null;
}

function normalizeText(value: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
