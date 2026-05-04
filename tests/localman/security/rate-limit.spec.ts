import { LocalManPage } from "../../../pages/localman/localman-page";
import { createCriticalPageMonitor, expectPageNotBlank, expectVisiblePageUi } from "../../../utils/assertions";
import { expect, test } from "../fixtures";

const NEARBY_ENDPOINT = "/api/vendors/nearby?lat=32.7767&lng=-96.797&location_source=precise&radius_km=10";
const RAPID_REQUEST_COUNT = 12;
const SAFE_500_THRESHOLD = 0;

type NearbyBurstResult = {
  bodyText: string;
  contentType: string;
  durationMs: number;
  endpoint: string;
  sequence: number;
  status: number;
};

test.describe("Local Man rate-limit safety", () => {
  test.describe.configure({ mode: "serial" });

  test("rapid nearby API requests do not trigger server failure and the app stays responsive", async ({ page, request }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i]
    });

    await localman.gotoHome();
    await localman.expectHomePageLoad();
    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, "Expected the Local Man public surface to load before the rate-limit probe.");

    const results = await runRapidNearbyBurst({
      endpoint: NEARBY_ENDPOINT,
      request,
      requestCount: RAPID_REQUEST_COUNT
    });

    const serverErrors = results.filter((result) => result.status >= 500);
    const jsonFailures = results.filter((result) => !result.contentType.includes("application/json"));
    const rateLimited = results.filter((result) => result.status === 429);
    const clientErrors = results.filter((result) => result.status >= 400 && result.status < 500);
    const durations = results.map((result) => result.durationMs);
    const avgDurationMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
    const maxDurationMs = Math.max(...durations);

    console.log(
      `LOCALMAN_RATE_LIMIT_SUMMARY ${JSON.stringify({
        avgDurationMs,
        clientErrorCount: clientErrors.length,
        endpoint: NEARBY_ENDPOINT,
        maxDurationMs,
        rateLimitDetected: rateLimited.length > 0,
        rateLimitedCount: rateLimited.length,
        requestCount: RAPID_REQUEST_COUNT,
        serverErrorCount: serverErrors.length,
        test: testInfo.title,
        timestamp: new Date().toISOString()
      })}`
    );

    expect(
      serverErrors.length,
      serverErrors.length === 0
        ? `Expected rapid nearby API requests to avoid 5xx responses.`
        : `Expected rapid nearby API requests to avoid 5xx responses, but observed:\n${serverErrors
            .map((result) => `#${result.sequence} status=${result.status} duration=${result.durationMs}ms`)
            .join("\n")}`
    ).toBeLessThanOrEqual(SAFE_500_THRESHOLD);

    expect(
      jsonFailures,
      jsonFailures.length === 0
        ? "Expected nearby API responses to remain JSON during the rate-limit probe."
        : `Expected nearby API responses to remain JSON during the rate-limit probe, but observed:\n${jsonFailures
            .map((result) => `#${result.sequence} status=${result.status} contentType="${result.contentType || "unknown"}"`)
            .join("\n")}`
    ).toEqual([]);

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();
    const state = await localman.detectDiscoveryState();
    await localman.expectVendorCardsOrValidEmptyState(state);
    await expectPageNotBlank(page);
    await expectVisiblePageUi(
      page,
      "Expected the Local Man public discovery surface to remain responsive after the nearby API burst."
    );

    await monitor.expectNoCriticalIssues();
  });
});

async function runRapidNearbyBurst(input: {
  endpoint: string;
  request: {
    get: (url: string, options?: { failOnStatusCode?: boolean }) => Promise<{
      headers(): Record<string, string>;
      redirectedFrom(): unknown;
      status(): number;
      text(): Promise<string>;
      url(): string;
    }>;
  };
  requestCount: number;
}): Promise<NearbyBurstResult[]> {
  const calls = Array.from({ length: input.requestCount }, (_, index) => runNearbyRequest(input.endpoint, input.request, index + 1));
  return Promise.all(calls);
}

async function runNearbyRequest(
  endpoint: string,
  request: {
    get: (url: string, options?: { failOnStatusCode?: boolean }) => Promise<{
      headers(): Record<string, string>;
      redirectedFrom(): unknown;
      status(): number;
      text(): Promise<string>;
      url(): string;
    }>;
  },
  sequence: number
): Promise<NearbyBurstResult> {
  const startedAt = Date.now();
  const response = await request.get(endpoint, {
    failOnStatusCode: false
  });
  const durationMs = Date.now() - startedAt;
  const bodyText = await response.text();
  const result: NearbyBurstResult = {
    bodyText,
    contentType: response.headers()["content-type"] ?? "",
    durationMs,
    endpoint: response.url(),
    sequence,
    status: response.status()
  };

  console.log(`LOCALMAN_RATE_LIMIT ${JSON.stringify(result)}`);
  return result;
}
