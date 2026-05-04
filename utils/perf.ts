import { expect, type Page, type Request } from "@playwright/test";

export const LOCALMAN_PERF_THRESHOLDS = {
  apiCallMs: 2_000,
  domLoadMs: 3_000,
  pageLoadMs: 6_000,
  totalLoadMs: 6_000
} as const;

export type LocalManPerfStatus = "fail" | "pass";

export type NavigationPerfMetric = {
  durationMs: number;
  kind: "navigation";
  metric: "dom-load" | "page-load" | "total-load";
  route: string;
  status: LocalManPerfStatus;
  thresholdMs: number;
  timestamp: string;
};

export type ApiPerfMetric = {
  durationMs: number;
  endpoint: string;
  kind: "api";
  method: string;
  route: string;
  status: LocalManPerfStatus;
  thresholdMs: number;
  timestamp: string;
};

export type RepeatedVisitSample = {
  route: string;
  totalLoadMs: number;
  visit: number;
};

export type LoadSimulationSummary = {
  avgTotalLoadMs: number;
  baselineTotalLoadMs: number;
  degradationMs: number;
  degradationPercent: number;
  kind: "load-simulation";
  maxTotalLoadMs: number;
  route: string;
  sampleCount: number;
  status: LocalManPerfStatus;
  thresholdMs: number;
  timestamp: string;
};

type ApiPerfEntry = ApiPerfMetric & {
  failureReason?: string;
  httpStatus?: number;
};

const DEFAULT_API_PATTERN = /\/api\/(?:vendors\/nearby|location\/reverse)/i;

export async function measureCurrentNavigation(page: Page, routeHint?: string): Promise<NavigationPerfMetric[]> {
  await page.waitForLoadState("load");

  const timing = await page.evaluate(() => {
    const navigationEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const entry = navigationEntries.at(-1);

    if (!entry) {
      return null;
    }

    return {
      domLoadMs: entry.domContentLoadedEventEnd,
      pageLoadMs: entry.responseEnd,
      totalLoadMs: entry.loadEventEnd || entry.duration
    };
  });

  expect(timing, "Expected browser navigation timing data for the current Local Man page.").not.toBeNull();

  const route = toRoute(routeHint ?? page.url());
  const metrics: NavigationPerfMetric[] = [
    createNavigationMetric(route, "page-load", timing!.pageLoadMs, LOCALMAN_PERF_THRESHOLDS.pageLoadMs),
    createNavigationMetric(route, "dom-load", timing!.domLoadMs, LOCALMAN_PERF_THRESHOLDS.domLoadMs),
    createNavigationMetric(route, "total-load", timing!.totalLoadMs, LOCALMAN_PERF_THRESHOLDS.totalLoadMs)
  ];

  for (const metric of metrics) {
    logPerfMetric(metric);
  }

  return metrics;
}

export function assertNavigationThresholds(metrics: NavigationPerfMetric[]): void {
  for (const metric of metrics) {
    expect(
      metric.durationMs,
      `Expected Local Man ${metric.metric} for route "${metric.route}" to stay under ${metric.thresholdMs}ms, but observed ${metric.durationMs}ms.`
    ).toBeLessThan(metric.thresholdMs);
  }
}

export function createApiPerfMonitor(
  page: Page,
  options: {
    endpointPattern?: RegExp;
  } = {}
) {
  const endpointPattern = options.endpointPattern ?? DEFAULT_API_PATTERN;
  const requestStarts = new Map<Request, number>();
  const entries: ApiPerfEntry[] = [];

  page.on("request", (request) => {
    if (!endpointPattern.test(request.url())) {
      return;
    }

    requestStarts.set(request, Date.now());
  });

  page.on("response", (response) => {
    const request = response.request();
    if (!endpointPattern.test(response.url())) {
      return;
    }

    const durationMs = Date.now() - (requestStarts.get(request) ?? Date.now());
    const entry: ApiPerfEntry = {
      durationMs,
      endpoint: response.url(),
      httpStatus: response.status(),
      kind: "api",
      method: request.method(),
      route: toRoute(page.url()),
      status: response.ok() && durationMs < LOCALMAN_PERF_THRESHOLDS.apiCallMs ? "pass" : "fail",
      thresholdMs: LOCALMAN_PERF_THRESHOLDS.apiCallMs,
      timestamp: new Date().toISOString()
    };

    if (!response.ok()) {
      entry.failureReason = `HTTP ${response.status()}`;
    }

    entries.push(entry);
    logPerfMetric(entry);
  });

  page.on("requestfailed", (request) => {
    if (!endpointPattern.test(request.url())) {
      return;
    }

    const entry: ApiPerfEntry = {
      durationMs: Date.now() - (requestStarts.get(request) ?? Date.now()),
      endpoint: request.url(),
      failureReason: request.failure()?.errorText ?? "request failed",
      kind: "api",
      method: request.method(),
      route: toRoute(page.url()),
      status: "fail",
      thresholdMs: LOCALMAN_PERF_THRESHOLDS.apiCallMs,
      timestamp: new Date().toISOString()
    };

    entries.push(entry);
    logPerfMetric(entry);
  });

  return {
    entries,
    async waitForCompletedCalls(
      options: {
        minimum?: number;
        timeoutMs?: number;
      } = {}
    ): Promise<ApiPerfEntry[]> {
      const minimum = options.minimum ?? 1;
      const timeoutMs = options.timeoutMs ?? 10_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (entries.length >= minimum) {
          return entries.slice();
        }

        await page.waitForTimeout(100);
      }

      throw new Error(
        `Expected at least ${minimum} Local Man API performance entries matching ${endpointPattern} within ${timeoutMs}ms.`
      );
    },

    assertWithinThresholds(options: { minimum?: number } = {}) {
      const minimum = options.minimum ?? 1;

      expect(
        entries.length,
        `Expected at least ${minimum} Local Man API calls to be observed for performance measurement.`
      ).toBeGreaterThanOrEqual(minimum);

      for (const entry of entries) {
        expect(
          entry.status,
          formatApiAssertionMessage(entry)
        ).toBe("pass");
      }
    }
  };
}

export function summarizeRepeatedVisits(
  route: string,
  samples: RepeatedVisitSample[],
  thresholdMs = LOCALMAN_PERF_THRESHOLDS.totalLoadMs
): LoadSimulationSummary {
  expect(samples.length, "Expected at least one repeated-visit sample to summarize load simulation.").toBeGreaterThan(0);

  const baselineTotalLoadMs = samples[0]!.totalLoadMs;
  const latestTotalLoadMs = samples[samples.length - 1]!.totalLoadMs;
  const totalValues = samples.map((sample) => sample.totalLoadMs);
  const avgTotalLoadMs = Math.round(totalValues.reduce((sum, value) => sum + value, 0) / totalValues.length);
  const maxTotalLoadMs = Math.max(...totalValues);
  const degradationMs = latestTotalLoadMs - baselineTotalLoadMs;
  const degradationPercent =
    baselineTotalLoadMs > 0 ? Math.round((degradationMs / baselineTotalLoadMs) * 100) : 0;

  const summary: LoadSimulationSummary = {
    avgTotalLoadMs,
    baselineTotalLoadMs,
    degradationMs,
    degradationPercent,
    kind: "load-simulation",
    maxTotalLoadMs,
    route: toRoute(route),
    sampleCount: samples.length,
    status: maxTotalLoadMs < thresholdMs ? "pass" : "fail",
    thresholdMs,
    timestamp: new Date().toISOString()
  };

  console.log(`LOCALMAN_LOAD_SIMULATION ${JSON.stringify(summary)}`);
  return summary;
}

function createNavigationMetric(
  route: string,
  metric: NavigationPerfMetric["metric"],
  durationMs: number,
  thresholdMs: number
): NavigationPerfMetric {
  const normalizedDuration = Math.max(0, Math.round(durationMs));

  return {
    durationMs: normalizedDuration,
    kind: "navigation",
    metric,
    route,
    status: normalizedDuration < thresholdMs ? "pass" : "fail",
    thresholdMs,
    timestamp: new Date().toISOString()
  };
}

function formatApiAssertionMessage(entry: ApiPerfEntry): string {
  const failureReason = entry.failureReason ? ` failure="${entry.failureReason}"` : "";
  const httpStatus = typeof entry.httpStatus === "number" ? ` status=${entry.httpStatus}` : "";
  return `Expected Local Man API ${entry.method} ${entry.endpoint} on route "${entry.route}" to stay under ${entry.thresholdMs}ms and succeed, but observed ${entry.durationMs}ms.${httpStatus}${failureReason}`;
}

function logPerfMetric(metric: NavigationPerfMetric | ApiPerfEntry): void {
  console.log(`LOCALMAN_PERF ${JSON.stringify(metric)}`);
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
